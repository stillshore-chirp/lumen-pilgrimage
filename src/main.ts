import { RESIDENCE_LABEL } from './coast/world/residence/residenceFloor';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('Missing #app mount point');
}

const options = new URLSearchParams(location.search);
const world = options.get('world');
const name = world === 'overlook' ? '丘陵展望台' : world === 'residence' ? RESIDENCE_LABEL : null;
try {
  if (options.get('monitor') === 'sender') {
    const { mountMonitorSender } = await import('./monitor/monitorSender');
    mountMonitorSender(mount);
  } else {
    const { CoastApp } = await import('./coast/CoastApp');
    if (name) {
      const loading = document.createElement('main');
      loading.className = 'coast-error';
      loading.setAttribute('role', 'status');
      loading.textContent = `${name}を読み込んでいます。`;
      mount.replaceChildren(loading);
      const scene = world === 'residence'
        ? await (await import('./coast/world/residence/ResidenceWorld')).loadResidenceScene()
        : await (await import('./coast/world/overlook/OverlookWorld')).loadOverlookScene();
      mount.replaceChildren();
      new CoastApp(mount, scene);
    } else {
      new CoastApp(mount);
    }
  }
} catch {
  console.error('Exploration scene could not start.');
  const notice = document.createElement('main');
  notice.className = 'coast-error';
  const message = document.createElement('p');
  message.textContent = options.get('monitor') === 'sender'
    ? '画面共有ページを読み込めませんでした。ページを再読み込みしてください。'
    : name
      ? `${name}を読み込めませんでした。ページを再読み込みしてください。`
      : '海岸の描画を開始できませんでした。Chrome の WebGL 2 とグラフィック アクセラレーションの設定を確認してください。';
  notice.append(message);
  if (name) {
    const coast = document.createElement('a');
    coast.href = '?world=coast';
    coast.textContent = '入り江と山道へ';
    notice.append(coast);
  }
  mount.replaceChildren(notice);
}
