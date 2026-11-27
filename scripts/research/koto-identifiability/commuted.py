"""Optional six-root magnitude/loss identifiability analysis; no audio or downloads."""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import sys
import numpy as np
import scipy
from scipy import linalg, optimize
from scipy.io import wavfile


def analyze_bank(bank_path):
    BANK = Path(bank_path).resolve()
    bank = json.loads(BANK.read_text())
    expected = {'low-151', 'mid-319', 'mid-452', 'high-640', 'high-792', 'low-240-candidate'}
    if {item['id'] for item in bank['samples']} != expected:
        raise ValueError('This bounded experiment requires the historical six-root bank, including the private 240 Hz crop.')
    roots = []
    centers=np.array([.04,.08,.12,.16]);width=.04
    for item in bank['samples']:
     sr,raw=wavfile.read(BANK.parent/item['path'])
     if sr != 48000 or raw.ndim != 1 or raw.dtype != np.int16:
      raise ValueError('The historical commuted identification requires 48 kHz mono PCM16.')
     if item['durationSeconds'] - item['fadeOutSeconds'] < .18:
      raise ValueError('An input ends before the fixed last measurement window.')
     x=raw.astype(np.float64)/32768
     f0=item['rootFrequency'];fmax=min(sr*.42,6*f0*1.02)
     a=round(.02*sr);b=round(.14*sr);fft=np.abs(np.fft.rfft(x[a:b]*np.hanning(b-a),65536));hz=np.fft.rfftfreq(65536,1/sr)
     frequencies=[];amplitude=[];phases=[]
     for n in range(1,7):
      ids=np.where((hz>n*f0*.982)&(hz<n*f0*1.018))[0];f=hz[ids[np.argmax(fft[ids])]];frequencies.append(f)
      levels=[];angles=[]
      for t in centers:
       a=round((t-width/2)*sr);b=round((t+width/2)*sr);w=np.hanning(b-a);time=np.arange(a,b)/sr
       z=2*np.sum(x[a:b]*w*np.exp(-2j*np.pi*f*time))/np.sum(w)
       levels.append(20*np.log10(max(abs(z),1e-12)));angles.append(float(np.angle(z)))
      amplitude.append(levels);phases.append(angles)
     roots.append({'id':item['id'],'sourceId':item['sourceId'],'f0':f0,'frequencies':frequencies,
      'amplitudeDbfs':amplitude,'phaseRadians':phases,'sourcePath':str(BANK.parent/item['path']),
      'sourceSha256':hashlib.sha256((BANK.parent/item['path']).read_bytes()).hexdigest(),
      'validEndSeconds':item['durationSeconds']-item['fadeOutSeconds']})

    freq=np.array([r['frequencies']for r in roots]);level=np.array([r['amplitudeDbfs']for r in roots])
    ratio=level[:,:,1]-level[:,0:1,1]
    knots=np.log(np.array([150,400,1000,2500,6000]))
    null=linalg.null_space(np.stack([np.ones(5),knots]))
    def hats(f):
     lf=np.log(f);result=np.zeros((np.size(f),len(knots)))
     for j in range(len(knots)):result[:,j]=np.interp(np.ravel(lf),knots,np.eye(len(knots))[j])
     return result
    rows=[];targets=[];ids=[];meta=[]
    for i,r in enumerate(roots):
     for n in range(1,6):
      row=np.zeros(5);row[n-1]=1
      curvature=(hats(freq[i,n])-hats(freq[i,0]))@null
      rows.append(np.r_[row,curvature.ravel()]);targets.append(ratio[i,n]);ids.append(i);meta.append((i,n))
    X=np.array(rows);Y=np.array(targets);ids=np.array(ids)
    cv=[]
    for i,r in enumerate(roots):
     train=ids!=i;test=~train
     base=linalg.lstsq(X[train,:5],Y[train])[0];body=linalg.lstsq(X[train],Y[train])[0]
     truth=Y[test];pb=X[test,:5]@base;pc=X[test]@body
     cv.append({'root':r['id'],'withoutBodyRmseDb':float(np.sqrt(np.mean((truth-pb)**2))),
      'sharedBodyRmseDb':float(np.sqrt(np.mean((truth-pc)**2))),
      'truthPartialRatiosDb':truth.tolist(),'withoutBodyPredictionDb':pb.tolist(),'sharedBodyPredictionDb':pc.tolist(),
      'bodyNodeDb':(null@body[5:]).tolist(),'designCondition':float(np.linalg.cond(X[train]))})

    # String-loss-only identification uses changes over time, so a fixed body or
    # microphone response cancels. A negative estimated decay is retained as evidence
    # against a single freely decaying mode; it is never silently made positive.
    t=centers[:3];tc=t-np.mean(t)
    slope=np.sum((level[:,:,:3]-np.mean(level[:,:,:3],axis=2,keepdims=True))*tc,axis=2)/np.sum(tc**2)
    sigma=-slope*np.log(10)/20
    loss_cv=[]
    for i,r in enumerate(roots):
     keep=np.arange(len(roots))!=i;F=freq[keep].ravel();S=sigma[keep].ravel();A=np.c_[np.ones(len(F)),(F/1000)**2]
     coef,_=optimize.nnls(A,S);constant=max(0,float(np.mean(S)))
     predicted_sigma=coef[0]+coef[1]*(freq[i]/1000)**2
     predicted_level=level[i,:,0]-20/np.log(10)*predicted_sigma*(centers[3]-centers[0])
     constant_level=level[i,:,0]-20/np.log(10)*constant*(centers[3]-centers[0])
     # The root's own first three windows are a descriptive local extrapolation,
     # not an independent shared-string-loss prediction.
     local_intercept=np.mean(level[i,:,:3],axis=1)-slope[i]*np.mean(t)
     local=local_intercept+slope[i]*centers[3]
     loss_cv.append({'root':r['id'],'sharedLossCoefficientsSigma':coef.tolist(),
      'observedEarlySigma':sigma[i].tolist(),'negativeSigmaCount':int(np.sum(sigma[i]<0)),
      'holdoutObservedDbfs':level[i,:,3].tolist(),'sharedPredictionDbfs':predicted_level.tolist(),
      'sharedLossWindowOutRmseDb':float(np.sqrt(np.mean((predicted_level-level[i,:,3])**2))),
      'constantLossWindowOutRmseDb':float(np.sqrt(np.mean((constant_level-level[i,:,3])**2))),
      'rootLocalWindowOutRmseDb':float(np.sqrt(np.mean((local-level[i,:,3])**2)))})

    result={'bankPath':str(BANK),'bankSha256':hashlib.sha256(BANK.read_bytes()).hexdigest(),
     'windowsSeconds':[(float(t-width/2),float(t+width/2))for t in centers],
     'features':'Complex Hann amplitudes around harmonics1..6; frequency chosen only from .02-.14s, fourth window held out.',
     'bodyModel':'normalized dB partial ratios = shared per-order excitation + shared absolute-Hz piecewise-linear log-frequency body curvature(3df); constant/tilt gauge removed',
     'bodyNodeHz':np.exp(knots).tolist(),'bodyLeaveOneRootOut':cv,
     'lossModel':'sigma(f)=a+b*(f/1000)^2, a,b>=0. Trained on other five roots using first3 windows; root initial levels anchor prediction of window4.',
     'lossLeaveOneRootAndWindowOut':loss_cv,'roots':roots,
     'bodyPooledWithoutRmseDb':float(np.sqrt(np.mean([r['withoutBodyRmseDb']**2 for r in cv]))),
     'bodyPooledSharedRmseDb':float(np.sqrt(np.mean([r['sharedBodyRmseDb']**2 for r in cv]))),
     'lossPooledSharedRmseDb':float(np.sqrt(np.mean([r['sharedLossWindowOutRmseDb']**2 for r in loss_cv]))),
     'lossPooledConstantRmseDb':float(np.sqrt(np.mean([r['constantLossWindowOutRmseDb']**2 for r in loss_cv]))),
     'limitations':['No physical body/bridge/excitation identifiability is asserted from a magnitude regression.',
     'Six roots come from two source recordings; identical instrument, mic and pluck conditions not established.',
     'Harmonic features describe short-window amplitude and can include beats, room, other strings and recording processing.',
     'No audio, waveguide output or repository edits made.']}
    return result


def joint_analysis(data):
    roots=data['roots'];level=np.array([r['amplitudeDbfs']for r in roots]);freq=np.array([r['frequencies']for r in roots])
    knots=np.log(np.array(data['bodyNodeHz']));null=linalg.null_space(np.stack([np.ones(5),knots]));times=np.array([.04,.08,.12,.16])
    def hat(f):return np.array([np.interp(np.log(f),knots,np.eye(5)[j])for j in range(5)])
    rows=[];truth=[];rootids=[];windowids=[]
    for i,r in enumerate(roots):
     for w,t in enumerate(times):
      for n in range(1,6):
       e=np.eye(5)[n-1];body=(hat(freq[i,n])-hat(freq[i,0]))@null
       loss=-20/np.log(10)*((freq[i,n]/1000)**2-(freq[i,0]/1000)**2)*(t-.08)
       rows.append(np.r_[e,body,loss]);truth.append(level[i,n,w]-level[i,0,w]);rootids.append(i);windowids.append(w)
    X=np.array(rows);Y=np.array(truth);R=np.array(rootids);W=np.array(windowids)
    def fit(mask,body):
     cols=np.arange(9)if body else np.r_[np.arange(5),8]
     A=X[mask][:,cols];low=np.full(len(cols),-np.inf);low[-1]=0
     sol=optimize.lsq_linear(A,Y[mask],bounds=(low,np.full(len(cols),np.inf)))
     return cols,sol.x,np.linalg.cond(A)
    results=[]
    for i,r in enumerate(roots):
     train=(R!=i)&(W<3);test=(R==i)&(W==3);out={'root':r['id']}
     for body in [False,True]:
      cols,p,condition=fit(train,body);error=X[test][:,cols]@p-Y[test]
      out['withBody'if body else 'withoutBody']={'rmseDb':float(np.sqrt(np.mean(error**2))),'parameters':p.tolist(),'condition':float(condition)}
     results.append(out)
    windowout={}
    for body in [False,True]:
     cols,p,condition=fit(W<3,body);error=X[W==3][:,cols]@p-Y[W==3]
     windowout['withBody'if body else 'withoutBody']={'rmseDb':float(np.sqrt(np.mean(error**2))),'parameters':p.tolist(),'condition':float(condition)}
    result={'model':'joint excitation-order(5), fixed-absolute-Hz body-curvature(3), nonnegative string-loss f² coefficient(1); root gain cancels in ratios',
     'leaveOneRootAndLastWindowOut':results,'leaveLastWindowOut':windowout,
     'pooledRootWindowOutWithoutBodyDb':float(np.sqrt(np.mean([r['withoutBody']['rmseDb']**2 for r in results]))),
     'pooledRootWindowOutWithBodyDb':float(np.sqrt(np.mean([r['withBody']['rmseDb']**2 for r in results])))}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bank', type=Path, required=True,
                        help='Explicit local six-root bank JSON; 240 Hz source is not bundled.')
    parser.add_argument('--output', type=Path, required=True, help='Combined analysis JSON output path.')
    args = parser.parse_args()
    study = analyze_bank(args.bank)
    result = {'study': study, 'joint': joint_analysis(study),
              'environment': {'python': sys.version.split()[0], 'numpy': np.__version__,
                              'scipy': scipy.__version__, 'platform': platform.platform(),
                              'machine': platform.machine()}}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(args.output), 'status': 'analysis-only'}))


if __name__ == '__main__':
    main()
