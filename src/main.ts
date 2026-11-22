export {};

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('Missing #app mount point');
}

if (new URLSearchParams(location.search).get('scene') === 'expedition') {
  const { AppBootstrap } = await import('./bootstrap/AppBootstrap');
  new AppBootstrap(mount).start();
} else {
  try {
    const { CoastApp } = await import('./coast/CoastApp');
    new CoastApp(mount);
  } catch (error) {
    console.error('Coastal exploration could not start', error);
    const notice = document.createElement('main');
    notice.className = 'coast-error';
    const message = document.createElement('p');
    message.textContent = '海岸の描画を開始できませんでした。Chrome の WebGL 2 とグラフィック アクセラレーションの設定を確認してください。';
    const legacy = document.createElement('a');
    legacy.href = '?scene=expedition';
    legacy.textContent = '従来のゲームへ';
    notice.append(message, legacy);
    mount.replaceChildren(notice);
  }
}
