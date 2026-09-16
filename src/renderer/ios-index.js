import './ios/FileSync';
import ReactDOM from 'react-dom';
import log from '../common/log.js';

if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
}

import('./ios-app.jsx').then(routeModule => {
    const appTarget = document.getElementById('app');
    ReactDOM.render(routeModule.default, appTarget);
}).catch(error => log.error('Error rendering iOS app: ', error));
