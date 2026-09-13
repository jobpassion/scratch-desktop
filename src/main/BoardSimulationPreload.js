/* global window */
import {contextBridge} from 'electron';

contextBridge.exposeInMainWorld('__VELXIO_API_BASE__', `${window.location.origin}/api`);
