export {};

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('Missing #app mount point');
}

const options = new URLSearchParams(location.search);
const overlook = options.get('world') === 'overlook';
try {
  if (options.get('monitor') === 'sender') {
    const { mountMonitorSender } = await import('./monitor/monitorSender');
    mountMonitorSender(mount);
  } else {
    const { CoastApp } = await import('./coast/CoastApp');
    if (overlook) {
      const loading = document.createElement('main');
      loading.className = 'coast-error';
      loading.setAttribute('role', 'status');
      loading.textContent = '丘陵展望台を読み込んでいます。';
      mount.replaceChildren(loading);
      const { loadOverlookScene } = await import('./coast/world/overlook/OverlookWorld');
      const world = await loadOverlookScene();
      mount.replaceChildren();
      new CoastApp(mount, world);
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
    : overlook
      ? '丘陵展望台を読み込めませんでした。ページを再読み込みしてください。'
      : '海岸の描画を開始できませんでした。Chrome の WebGL 2 とグラフィック アクセラレーションの設定を確認してください。';
  notice.append(message);
  if (overlook) {
    const coast = document.createElement('a');
    coast.href = '?world=coast';
    coast.textContent = '入り江と山道へ';
    notice.append(coast);
  }
  mount.replaceChildren(notice);
}
