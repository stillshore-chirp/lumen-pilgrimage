"""Optional, bounded analysis of low-151; no synthesis/audio output or downloads."""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import sys
import time
import numpy as np
import scipy
from scipy import signal, linalg, optimize
from scipy.io import wavfile


def run(bank_path):
    bank_path = Path(bank_path).resolve()
    bank = json.loads(bank_path.read_text())
    item = next(x for x in bank['samples'] if x['id'] == 'low-151')
    source = bank_path.parent / item['path']
    sr, raw = wavfile.read(source)
    if sr != 48000 or raw.ndim != 1 or raw.dtype != np.int16:
        raise ValueError('The historical matrix-pencil experiment requires 48 kHz mono PCM16.')
    if len(raw) / sr - item['fadeOutSeconds'] < .777 - 1e-9:
        raise ValueError('The source ends before the fixed historical holdout window.')
    x = raw.astype(np.float64) / 32768
    fs=4000
    y=signal.resample_poly(x,1,12)
    f0=item['rootFrequency']; valid_end=item['durationSeconds']-item['fadeOutSeconds']
    hold_start=.707;hold_end=.773
    train_start=.457;train_end=.687
    H=lambda z:hashlib.sha256(z).hexdigest()

    def metrics(pred,actual):
        ratio=float(linalg.norm(pred-actual)/max(linalg.norm(actual),1e-30))
        return {'relativeRmsError':ratio,'errorDb':20*np.log10(max(ratio,1e-30))}

    def basis(t,f,sigma):
        e=np.exp(-t[:,None]*sigma[None,:]);phase=2*np.pi*t[:,None]*f[None,:]
        return np.column_stack((e*np.cos(phase),e*np.sin(phase)))

    def fit_coeff(t,observed,f,sigma):
        A=basis(t,f,sigma);coef,_,_,sing=linalg.lstsq(A,observed)
        return coef, float(sing[0]/max(sing[-1],1e-30))

    def predict(t,f,sigma,coef): return basis(t,f,sigma)@coef

    def pencil(observed,rank,fraction):
        n=len(observed);L=int(n*fraction)
        data=np.lib.stride_tricks.sliding_window_view(observed,L+1)
        Y0=data[:,:-1].copy();Y1=data[:,1:].copy()
        U,s,Vh=linalg.svd(Y0,full_matrices=False,lapack_driver='gesdd')
        Z=((U[:,:rank].T@Y1@Vh[:rank].T).T/s[:rank]).T
        poles=linalg.eigvals(Z);lam=np.log(poles)*fs
        keep=(lam.imag>2*np.pi*40)&(lam.imag<2*np.pi*1950)&(np.abs(lam.real)<500)
        f=lam.imag[keep]/(2*np.pi);sigma=-lam.real[keep]
        order=np.argsort(f);f=f[order];sigma=sigma[order]
        t=np.arange(n)/fs;coef,condition=fit_coeff(t,observed,f,sigma)
        m=len(f);amp=np.hypot(coef[:m],coef[m:]);harmonic=np.rint(f/f0).astype(int)
        distance=np.abs(f-harmonic*f0)
        close=(harmonic>=1)&(harmonic<=12)&(distance<.018*harmonic*f0)
        rows=[{'frequencyHz':float(f[i]),'sigmaPerSecond':float(sigma[i]),'decayDbPerSecond':float(-20/np.log(10)*sigma[i]),
          'amplitudeDbfs':float(20*np.log10(max(amp[i],1e-30))), 'stable':bool(sigma[i]>=0),'harmonic':int(harmonic[i]),'nearHarmonic':bool(close[i])}for i in range(m)]
        return f,sigma,coef,{'rank':rank,'L':L,'N':n,'singularRatios':(s[:min(60,len(s))]/s[0]).tolist(),
          'rankGap':float(s[rank-1]/s[rank]),'coefficientCondition':condition,'modes':rows}

    def assess(f,sigma,coef,start,end):
        ti=np.arange(round(start*fs),round(end*fs));t=ti/fs-train_start
        pi=np.arange(round(start*sr),round(end*sr));tp=pi/sr-train_start
        return {'bandlimited4k':metrics(predict(t,f,sigma,coef),y[ti]),
          'fullBand48k':metrics(predict(tp,f,sigma,coef),x[pi])}

    def grouped_selection(f,sigma,coef,per_harmonic,stable_only):
        m=len(f);amp=np.hypot(coef[:m],coef[m:]);ids=[]
        for h in range(1,13):
          eligible=np.where((np.abs(f-h*f0)<.018*h*f0)&((sigma>=0)if stable_only else True))[0]
          ids.extend(eligible[np.argsort(amp[eligible])[::-1]][:per_harmonic])
        return np.array(sorted(ids),dtype=int)

    started=time.perf_counter()
    observed=y[round(train_start*fs):round(train_end*fs)]
    results=[];pool=None
    for rank in [24,48]:
     for fraction in [1/3,.5]:
        f,sigma,coef,info=pencil(observed,rank,fraction)
        info['train']=assess(f,sigma,coef,train_start,train_end)
        info['holdout']=assess(f,sigma,coef,hold_start,hold_end)
        info['growingModeCount']=int(np.sum(sigma<0))
        results.append(info)
        if rank==48 and fraction==1/3: pool=(f,sigma,coef)

    # Strict stable, near-harmonic one/two-mode comparisons use the same pole pool.
    # No growing pole is reflected into the stable half-plane.
    grouped=[]
    for per in [1,2]:
     for stable in [False,True]:
        f,sigma,coef=pool;ids=grouped_selection(f,sigma,coef,per,stable)
        ff=f[ids];ss=sigma[ids]
        c,condition=fit_coeff(np.arange(len(observed))/fs,observed,ff,ss)
        record={'maximumModesPerHarmonic':per,'stableOnly':stable,'selectedCount':len(ids),
          'coefficientCondition':condition,'frequencies':ff.tolist(),'sigmas':ss.tolist(),
          'train':assess(ff,ss,c,train_start,train_end),'holdout':assess(ff,ss,c,hold_start,hold_end)}
        grouped.append(record)

    # The direct fit uses one or two modes at every harmonic. Frequencies and decay
    # are constrained, but coefficients/phases are estimated from training data only.
    def nonlinear_fit(per,start,stop,max_nfev=100):
        obs=y[round(start*fs):round(stop*fs)]
        t=np.arange(len(obs))/fs;scale=np.sqrt(np.mean(obs**2));normalized=obs/scale
        spec=np.abs(np.fft.rfft(obs*np.hanning(len(obs)),32768));freq=np.fft.rfftfreq(32768,1/fs)
        frequencies=[];sigmas=[];lower=[];upper=[]
        pf,ps,pc=pool;pm=len(pf);pa=np.hypot(pc[:pm],pc[pm:])
        for h in range(1,13):
          lo=h*f0*(1-.018);hi=h*f0*(1+.018)
          candidates=np.where((pf>lo)&(pf<hi)&(ps>0)&(ps<120))[0]
          candidates=candidates[np.argsort(pa[candidates])[::-1]]
          pick=np.where((freq>=lo)&(freq<=hi))[0];peak=freq[pick[np.argmax(spec[pick])]]
          for j in range(per):
            initial=float(pf[candidates[j]])if len(candidates)>j else peak+(j-(per-1)/2)*1.5
            initial_sigma=float(ps[candidates[j]])if len(candidates)>j else 4.0+2*j
            frequencies.append(np.clip(initial,lo+1e-4,hi-1e-4));sigmas.append(np.clip(initial_sigma,.01,119.99))
            lower.extend([lo,0,-np.inf,-np.inf]);upper.extend([hi,120,np.inf,np.inf])
        f=np.array(frequencies);s=np.array(sigmas);c,_=fit_coeff(t,normalized,f,s);m=len(f)
        p=np.column_stack((f,s,c[:m],c[m:])).ravel()
        def residual(params):
          v=params.reshape(-1,4);e=np.exp(-t[:,None]*v[:,1]);angle=2*np.pi*t[:,None]*v[:,0]
          return np.sum(e*(v[:,2]*np.cos(angle)+v[:,3]*np.sin(angle)),axis=1)-normalized
        def jac(params):
          v=params.reshape(-1,4);e=np.exp(-t[:,None]*v[:,1]);angle=2*np.pi*t[:,None]*v[:,0];co=np.cos(angle);si=np.sin(angle)
          J=np.empty((len(t),4*len(v)));J[:,0::4]=2*np.pi*t[:,None]*e*(-v[:,2]*si+v[:,3]*co)
          J[:,1::4]=-t[:,None]*e*(v[:,2]*co+v[:,3]*si);J[:,2::4]=e*co;J[:,3::4]=e*si
          return J
        sol=optimize.least_squares(residual,p,jac=jac,bounds=(lower,upper),x_scale='jac',max_nfev=max_nfev,
          ftol=1e-9,xtol=1e-9,gtol=1e-7)
        v=sol.x.reshape(-1,4);f=v[:,0];s=v[:,1];c=np.r_[v[:,2],v[:,3]]*scale
        singular=linalg.svdvals(jac(sol.x));condition=float(singular[0]/max(singular[-1],1e-30))
        def at(a,b,full=False):
          rate=sr if full else fs;ids=np.arange(round(a*rate),round(b*rate));tt=ids/rate-start
          return metrics(predict(tt,f,s,c),(x if full else y)[ids])
        return {'modesPerHarmonic':per,'window':[start,stop],'success':bool(sol.success),'nfev':sol.nfev,
          'jacobianCondition':condition,'train4k':at(start,stop),'holdout4k':at(hold_start,hold_end),
          'holdoutFullBand':at(hold_start,hold_end,True),'frequencies':f.tolist(),'sigmas':s.tolist(),
          'amplitudesAtTrainStart':np.hypot(c[:len(f)],c[len(f):]).tolist(),
          'nearZeroDecayCount':int(np.sum(s<.01)),'atFrequencyBoundCount':int(np.sum((sol.x-np.array(lower)<1e-4)|(np.array(upper)-sol.x<1e-4))),
          'coefficients':c.tolist()}

    nonlinear=[]
    for per in [1,2]:
     for a,b in [(train_start,train_end),(.417,train_end),(.497,train_end)]:
        record=nonlinear_fit(per,a,b,1000 if per == 2 else 100);nonlinear.append(record)

    # Boundary predictions are inspected but no sound/extension is generated.
    boundary=[]
    for r in nonlinear:
     if r['window']!=[train_start,train_end]:continue
     f=np.array(r['frequencies']);s=np.array(r['sigmas']);c=np.array(r['coefficients'])
     ts=np.arange(round(.742*sr),round(.777*sr))/sr;pred=predict(ts-train_start,f,s,c);actual=x[np.round(ts*sr).astype(int)]
     boundary.append({'modesPerHarmonic':r['modesPerHarmonic'],'last35msResidual':metrics(pred,actual),
      'endpointSampleMismatch':float(pred[-1]-actual[-1]),'originalLocalRms':float(np.sqrt(np.mean(actual**2))),
      'predictedRmsAfter100ms':float(np.sqrt(np.mean(predict(ts+.1-train_start,f,s,c)**2))),
      'predictedRmsAfter500ms':float(np.sqrt(np.mean(predict(ts+.5-train_start,f,s,c)**2)))})

    result={'sourcePath':str(source),'sourceSha256':H(source.read_bytes()),'sourceItem':item,'sampleRate':sr,'fitSampleRate':fs,
     'downsampling':'scipy resample_poly 1/12; train/holdout gap20ms exceeds finite anti-alias FIR support; holdout never fitted',
     'trainingWindow':[train_start,train_end],'holdoutWindow':[hold_start,hold_end],'pencil':results,'grouped':grouped,
     'nonlinear':nonlinear,'boundary':boundary,'elapsedSeconds':time.perf_counter()-started,
     'limitations':['One lossy recorded take; not evidence of two physical polarizations or even one isolated string.',
     'Short holdout validates only 66 ms within the recording; no natural sustained tail is inferred.',
     'No repository/source/audio/manifest edits; no extrapolated sound files generated.']}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    default_bank = Path(__file__).resolve().parents[3] / 'public/lake-audio/samples/bank.json'
    parser.add_argument('--bank', type=Path, default=default_bank,
                        help='Local bank containing low-151; defaults to the repository bank.')
    parser.add_argument('--output', type=Path, required=True, help='JSON output path; no audio is written.')
    args = parser.parse_args()
    result = run(args.bank)
    result['environment'] = {'python': sys.version.split()[0], 'numpy': np.__version__,
                             'scipy': scipy.__version__, 'platform': platform.platform(),
                             'machine': platform.machine()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(args.output), 'status': 'analysis-only'}))


if __name__ == '__main__':
    main()
