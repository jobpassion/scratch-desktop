import React from 'react';

const ScratchIOSAppStateHOC = function (WrappedComponent) {
    class ScratchIOSAppStateComponent extends React.Component {
        render () {
            return (<WrappedComponent
                isTelemetryEnabled={false}
                onTelemetryModalOptIn={() => {}}
                onTelemetryModalOptOut={() => {}}
                showTelemetryModal={false}
                {...this.props}
            />);
        }
    }
    return ScratchIOSAppStateComponent;
};

export default ScratchIOSAppStateHOC;
