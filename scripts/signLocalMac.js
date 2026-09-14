const {execFileSync} = require('child_process');
const path = require('path');

module.exports = options => {
    const entitlements = path.join(__dirname, '../buildResources/entitlements.mac.plist');
    execFileSync('codesign', [
        '--force', '--deep', '--sign', '-', '--options', 'runtime',
        '--entitlements', entitlements, options.app
    ], {stdio: 'inherit'});
    execFileSync('codesign', ['--verify', '--deep', '--strict', options.app], {stdio: 'inherit'});
};
