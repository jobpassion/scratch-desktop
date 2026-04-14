import React from 'react';
import packageJson from '../../package.json';

import logo from '../icon/ScratchDesktop.png';
import yiyiHero from './assets/yiyi-hero.jpg';
import styles from './about.css';

const AboutElement = () => (
    <div className={styles.aboutBox}>
        <div className={styles.aboutHero}>
            <img
                alt="一一编程乐园主视觉"
                src={yiyiHero}
                className={styles.heroImage}
            />
            <img
                alt={`${packageJson.productName} icon`}
                src={logo}
                className={styles.aboutLogo}
            />
        </div>
        <div className={styles.aboutText}>
            <div className={styles.aboutBadge}>送给贾一一的编程礼物</div>
            <h2>{packageJson.productName}</h2>
            <p className={styles.aboutMessage}>
                愿你在这里学会用代码讲故事、做游戏、画出想象中的彩虹和星星。
            </p>
            <div className={styles.versionLabel}>Version {packageJson.version}</div>
            <table className={styles.aboutDetails}><tbody>
                {
                    ['Electron', 'Chrome', 'Node'].map(component => {
                        const componentVersion = process.versions[component.toLowerCase()];
                        return <tr key={component}><td>{component}</td><td>{componentVersion}</td></tr>;
                    })
                }
            </tbody></table>
        </div>
    </div>
);

export default <AboutElement />;
