import { RESIDENCE_LABEL } from './coast/world/residence/residenceFloor';
import { CINEMA_LABEL } from './coast/world/cinema/cinemaLayout';
import { ATRIUM_LABEL } from './coast/world/atrium/atriumLayout';
import { LAKE_LABEL } from './coast/world/lake/lakeLayout';
import { parseStartupRoute } from './coast/explorationRoute';

const mount = document.querySelector<HTMLDivElement>('#app');
if (!mount) {
  throw new Error('Missing #app mount point');
}

const route = parseStartupRoute(location.search);
const name = route.worldId === 'overlook' ? '丘陵展望台' : route.worldId === 'residence' ? RESIDENCE_LABEL :
  route.worldId === 'cinema' ? CINEMA_LABEL : route.worldId === 'atrium' ? ATRIUM_LABEL :
  route.worldId === 'lake' ? LAKE_LABEL : null;
try {
  if (route.monitorSender) {
    const { mountMonitorSender } = await import('./monitor/monitorSender');
    mountMonitorSender(mount);
  } else {
    const { CoastApp, loadExplorationScene } = await import('./coast/CoastApp');
    if (name) {
      const loading = document.createElement('main');
      loading.className = 'coast-error';
      loading.setAttribute('role', 'status');
      loading.textContent = `${name}を読み込んでいます。`;
      mount.replaceChildren(loading);
    }
    const scene = await loadExplorationScene(route.worldId);
    new CoastApp(mount, scene).start();
  }
} catch {
  console.error('Exploration scene could not start.');
  const notice = document.createElement('main');
  notice.className = 'coast-error';
  const message = document.createElement('p');
  message.textContent = route.monitorSender
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
