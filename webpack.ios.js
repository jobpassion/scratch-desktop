const path = require('path');
const fsExtra = require('fs-extra');
const webpack = require('webpack');

const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const makeConfig = require('./webpack.makeConfig.js');

fsExtra.ensureDirSync('dist');

const getModulePath = moduleName => path.dirname(require.resolve(`${moduleName}`));
const template = fsExtra.readFileSync('src/renderer/index.html', {encoding: 'utf8'});

module.exports = makeConfig(
    {
        target: 'web',
        entry: {
            renderer: './src/renderer/ios-index.js'
        },
        context: path.resolve(__dirname),
        output: {
            filename: '[name].js',
            assetModuleFilename: 'static/assets/[name].[hash][ext]',
            chunkFilename: '[name].bundle.js',
            publicPath: './',
            path: path.resolve(__dirname, 'ios/App/Web')
        },
        module: {
            rules: [
                {
                    test: /\.(html)$/,
                    use: {loader: 'html-loader'}
                }
            ]
        }
    },
    {
        name: 'ios',
        useReact: true,
        disableDefaultRulesForExtensions: ['js', 'jsx', 'css', 'svg', 'png', 'wav', 'gif', 'jpg', 'ttf'],
        babelPaths: [
            path.resolve(__dirname, 'src', 'renderer'),
            path.resolve(__dirname, 'src', 'common'),
            /node_modules[\\/]+@scratch[\\/]+[^\\/]+[\\/]+src/,
            /node_modules[\\/]+pify/,
            /node_modules[\\/]+@vernier[\\/]+godirect/
        ],
        plugins: [
            new webpack.NormalModuleReplacementPlugin(
                /^electron$/,
                path.resolve(__dirname, 'src/renderer/ios/electron-shim.js')
            ),
            new webpack.NormalModuleReplacementPlugin(
                /^buffer$/,
                path.resolve(__dirname, 'src/renderer/ios/buffer-shim.js')
            ),
            new webpack.NormalModuleReplacementPlugin(
                /ElectronStorageHelper$/,
                path.resolve(__dirname, 'src/common/IOSStorageHelper.js')
            ),
            new webpack.NormalModuleReplacementPlugin(
                /ESP32Bluetooth$/,
                path.resolve(__dirname, 'src/renderer/board/IOSBluetooth.js')
            ),
            new webpack.NormalModuleReplacementPlugin(
                /scratch-logo(-android)?\.svg$/,
                resource => {
                    resource.request = path.resolve(__dirname, 'src/renderer/assets/yiyi-menu-logo.svg');
                }
            ),
            new HtmlWebpackPlugin({
                filename: 'index.html',
                templateContent: template,
                minify: false
            }),
            new CopyWebpackPlugin({
                patterns: [
                    {
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'static'),
                        to: 'static'
                    },
                    {
                        from: 'extension-worker.{js,js.map}',
                        context: getModulePath('@scratch/scratch-gui')
                    },
                    {
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'libraries'),
                        to: 'static/libraries',
                        flatten: true
                    },
                    {
                        from: path.join(getModulePath('@scratch/scratch-gui'), 'chunks'),
                        to: 'chunks'
                    },
                    {
                        from: path.resolve(__dirname, 'static/fetched'),
                        to: 'static/fetched',
                        noErrorOnMissing: true
                    }
                ]
            })
        ]
    }
);
