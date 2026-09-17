import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';

import {installQuickExtensionLoader} from './board/QuickExtensionRegistry';
import {syncQuickExtensionsToLibrary} from './board/QuickExtensionLibrary';
import {
    removeQuickExtensionManagerEntry,
    syncQuickExtensionManagerEntry
} from './board/QuickExtensionManager';

const QuickExtensionHOC = WrappedComponent => {
    class QuickExtensionComponent extends React.Component {
        constructor (props) {
            super(props);
            this.ensureBoardMode = this.ensureBoardMode.bind(this);
            this.handleExtensionActivated = this.handleExtensionActivated.bind(this);
            this.syncManagerEntry = this.syncManagerEntry.bind(this);
            this.boardModeTimers = [];
            syncQuickExtensionsToLibrary();
            this.installForVM(props.vm);
        }

        componentDidMount () {
            this.syncManagerEntry();
            this.managerTimer = window.setInterval(this.syncManagerEntry, 300);
        }

        componentDidUpdate (prevProps) {
            if (prevProps.vm !== this.props.vm) this.installForVM(this.props.vm);
        }

        componentWillUnmount () {
            window.clearInterval(this.managerTimer);
            this.boardModeTimers.forEach(timer => window.clearTimeout(timer));
            this.boardModeTimers = [];
            removeQuickExtensionManagerEntry();
        }

        installForVM (vm) {
            if (!vm) return;
            installQuickExtensionLoader(vm, this.handleExtensionActivated);
        }

        ensureBoardMode () {
            const button = document.getElementById('desktop-board-programming-button');
            if (!button) return;
            const text = (button.textContent || '').trim();
            const isBoardMode = document.body.classList.contains('desktop-board-mode') ||
                text.includes('返回普通编程');
            if (!isBoardMode) button.click();
        }

        handleExtensionActivated () {
            this.boardModeTimers.forEach(timer => window.clearTimeout(timer));
            this.boardModeTimers = [0, 150, 400, 900, 1600].map(delay =>
                window.setTimeout(this.ensureBoardMode, delay)
            );
        }

        syncManagerEntry () {
            syncQuickExtensionManagerEntry(this.props.vm, this.handleExtensionActivated);
        }

        render () {
            return <WrappedComponent {...this.props} />;
        }
    }

    QuickExtensionComponent.propTypes = {
        vm: PropTypes.shape({
            extensionManager: PropTypes.object
        })
    };

    const mapStateToProps = state => ({
        vm: state.scratchGui.vm
    });

    return connect(mapStateToProps)(QuickExtensionComponent);
};

export default QuickExtensionHOC;
