import { EventEmitter } from 'events';
import { Window } from 'node-screenshots';
import { compareImageSimilarity } from './image.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from '../config.json' with { type: 'json' };
import zones from '../data/zones.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface WindowConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  appName: string;
  visible: boolean;
}

interface CaptureZone {
  name: string;
  left: number;
  width: number;
  top: number;
  bottom: number;
}

interface CropArea {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  absoluteX: number;
  absoluteY: number;
}

interface WindowInfo {
  window: WindowConfig;
  captures: CropArea[];
}

interface Config {
  hotkey: string;
  umamusume: string;
  debug: boolean;
  padding: {
    top: number;
    bottom: number;
  };
}

interface WindowState {
  isCareerProfileActive: boolean;
  isMenuOpened: boolean;
  lastCareerProfileCheck: number;
}

class WindowTracker extends EventEmitter {
  interval: NodeJS.Timeout | null = null;
  lastWindowInfo: WindowInfo | null = null;
  configPath: string;
  umamusumeWindow: Window | null = null;
  windowState: WindowState;
  CAREER_PROFILE_CHECK_INTERVAL = 100;

  constructor(configPath: string = './config.json') {
    super();
    this.configPath = configPath;
    this.windowState = {
      isCareerProfileActive: false,
      isMenuOpened: false,
      lastCareerProfileCheck: 0
    };

    this.interval = setInterval(async () => {
      const currentInfo = this.getWindowInfo();

      if (!currentInfo) {
        if (this.lastWindowInfo?.window.visible) {
          this.emit('windowHidden');
          this.lastWindowInfo = null;
        }
        return;
      }

      if (!this.lastWindowInfo) {
        this.emit('windowFound', currentInfo);
        this.lastWindowInfo = currentInfo;
      }

      if (this.lastWindowInfo && this.hasWindowChanged(currentInfo, this.lastWindowInfo)) {
        this.emit('windowMoved', currentInfo);
        this.lastWindowInfo = currentInfo;
      }

      await this.checkCareerProfilePageActive();
    }, 1000 / 30);

    console.log('Window tracker started (30 FPS)');
  }

  findWindow(): Window | null {
    const windows: Window[] = Window.all();
    const found = windows.find((w: Window) => w.title.includes('Umamusume')) || null;
    this.umamusumeWindow = found;
    return found;
  }

  calculateCaptureZones(windowWidth: number, windowHeight: number): CropArea[] {
    const availableHeight = windowHeight - config.padding.top - config.padding.bottom;

    return zones.map((zone: CaptureZone) => {
      const x = Math.floor(windowWidth * zone.left);
      const y = config.padding.top + Math.floor(availableHeight * zone.top);
      const width = Math.floor(windowWidth * zone.width);
      const height = Math.floor(availableHeight * (1 - zone.top - zone.bottom));

      return {
        name: zone.name,
        x,
        y,
        width,
        height,
        absoluteX: 0,
        absoluteY: 0
      };
    });
  }

  getWindowInfo(): WindowInfo | null {
    const window = this.findWindow();
    if (!window) return null;

    const { x, y, width, height, title, appName } = window;
    const captures = this.calculateCaptureZones(width, height);

    captures.forEach(capture => {
      capture.absoluteX = x + capture.x;
      capture.absoluteY = y + capture.y;
    });

    return {
      window: { x, y, width, height, title, appName, visible: true },
      captures
    };
  }

  hasWindowChanged(current: WindowInfo, previous: WindowInfo): boolean {
    return (
      current.window.x !== previous.window.x ||
      current.window.y !== previous.window.y ||
      current.window.width !== previous.window.width ||
      current.window.height !== previous.window.height ||
      current.window.visible !== previous.window.visible
    );
  }

  async checkCareerProfilePageActive(): Promise<boolean> {
    const now = Date.now();
    if (now - this.windowState.lastCareerProfileCheck < this.CAREER_PROFILE_CHECK_INTERVAL) {
      return this.windowState.isCareerProfileActive;
    }

    const windowInfo = this.getWindowInfo();
    if (!windowInfo || !this.umamusumeWindow) {
      return false;
    }

    try {
      const image = await this.umamusumeWindow.captureImage();
      const careerProfileIconZone = windowInfo.captures.find(capture => capture.name === 'career_profile_icon');
      if (!careerProfileIconZone) {
        return false;
      }

      const { x, y, width, height } = careerProfileIconZone;
      const careerProfileIcon = await image.crop(x, y, width, height);
      const blurRefImagePath = join(__dirname, '../images/umamusume/ui/career_profile_icon_blurred.png');
      const iconRefImagePath = join(__dirname, '../images/umamusume/ui/career_profile_icon.png');
      const blurResult = await compareImageSimilarity(blurRefImagePath, await careerProfileIcon.toPng());
      const iconResult = await compareImageSimilarity(iconRefImagePath, await careerProfileIcon.toPng());
      const isActive = iconResult || blurResult;
      const wasActive = this.windowState.isCareerProfileActive;
      const wasBlurred = this.windowState.isMenuOpened;

      if (isActive && !wasActive) {
        this.emit('career_profile', { active: true });
      } else if (!isActive && wasActive) {
        this.emit('career_profile', { active: false });
      }

      if (blurResult && !wasBlurred) {
        this.emit('menu', { blur: true });
      } else if (!blurResult && wasBlurred) {
        this.emit('menu', { blur: false });
      }

      this.windowState.isCareerProfileActive = isActive;
      this.windowState.isMenuOpened = blurResult;
      this.windowState.lastCareerProfileCheck = now;

      return isActive;
    } catch (error) {
      console.error('Error checking career profile page:', error);
      return false;
    }
  }

  getCurrentWindow(): WindowInfo | null {
    return this.lastWindowInfo;
  }

  getWindowState(): WindowState {
    return { ...this.windowState };
  }
}

export { WindowTracker, WindowInfo, WindowConfig, CropArea, WindowState };
