import React from 'react';
import {compose} from 'redux';
import GUI, {AppStateHOC} from '@scratch/scratch-gui';

import ScratchIOSAppStateHOC from './ScratchIOSAppStateHOC.jsx';
import ScratchIOSGUIHOC from './ScratchIOSGUIHOC.jsx';
import styles from './app.css';
import './ios.css';

const appTarget = document.getElementById('app');
appTarget.className = styles.app || 'app';

GUI.setAppElement(appTarget);

const WrappedGui = compose(
    ScratchIOSAppStateHOC,
    AppStateHOC,
    ScratchIOSGUIHOC
)(GUI);

export default <WrappedGui />;
