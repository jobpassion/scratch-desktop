import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';

import MenuComponent from '@scratch/scratch-gui/src/components/menu/menu.jsx';

class Menu extends React.Component {
    constructor (props) {
        super(props);
        this.listenerTimer = null;
        bindAll(this, [
            'addListeners',
            'removeListeners',
            'handleClick',
            'ref'
        ]);
    }
    componentDidMount () {
        if (this.props.open) this.addListeners();
    }
    componentDidUpdate (prevProps) {
        if (this.props.open && !prevProps.open) this.addListeners();
        if (!this.props.open && prevProps.open) this.removeListeners();
    }
    componentWillUnmount () {
        this.removeListeners();
    }
    addListeners () {
        // WKWebView can deliver the same mouseup which opened the menu to a
        // document-level listener registered synchronously during that event.
        // Defer registration so the opening mouseup cannot immediately close it.
        this.removeListeners();
        this.listenerTimer = window.setTimeout(() => {
            this.listenerTimer = null;
            if (this.props.open) {
                document.addEventListener('mouseup', this.handleClick);
            }
        }, 0);
    }
    removeListeners () {
        if (this.listenerTimer !== null) {
            window.clearTimeout(this.listenerTimer);
            this.listenerTimer = null;
        }
        document.removeEventListener('mouseup', this.handleClick);
    }
    handleClick (e) {
        if (this.props.open && this.menu && !this.menu.contains(e.target)) {
            this.props.onRequestClose();
        }
    }
    ref (c) {
        this.menu = c;
    }
    render () {
        const {
            open,
            children,
            ...props
        } = this.props;
        if (!open) return null;
        return (
            <MenuComponent
                componentRef={this.ref}
                {...props}
            >
                {children}
            </MenuComponent>
        );
    }
}

Menu.propTypes = {
    children: PropTypes.node,
    onRequestClose: PropTypes.func.isRequired,
    open: PropTypes.bool.isRequired
};

export default Menu;
