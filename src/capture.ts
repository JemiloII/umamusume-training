import { EventEmitter } from 'events';
import { GlobalKeyboardListener } from 'node-global-key-listener';
import config from '../config.json' with { type: 'json' };

interface Config {
  hotkey: string;
  umamusume: string;
  debug: boolean;
  padding: {
    top: number;
    bottom: number;
  };
}

interface CaptureResult {
  eventCropArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

class CaptureManager extends EventEmitter {
  config: Config;
  gkl: GlobalKeyboardListener;
  hotkeyConfig: { modifiers: string[]; key: string | undefined };

  constructor() {
    super();
    this.gkl = new GlobalKeyboardListener();
    this.hotkeyConfig = this.parseHotkey(config.hotkey);
    this.setupHotkey();
    console.log(`Capture manager active. Press ${config.hotkey} to capture screenshot.`);
  }

  parseHotkey(hotkeyString: string) {
    const parts = hotkeyString.toLowerCase().split(' + ').map(s => s.trim());
    const modifiers = parts.filter(p => ['ctrl', 'shift', 'alt'].includes(p));
    const key = parts.find(p => !['ctrl', 'shift', 'alt'].includes(p))?.toUpperCase();

    return { modifiers, key };
  }

  async captureZone(zoneName: string, windowInfo?: any, umamusumeWindow?: any): Promise<Buffer | null> {
    if (!windowInfo || !umamusumeWindow) {
      console.log('Window info or window not available for zone capture');
      return null;
    }

    try {
      const image = await umamusumeWindow.captureImage();
      const zone = windowInfo.captures.find((capture: any) => capture.name === zoneName);

      if (!zone) {
        console.log(`${zoneName} capture zone not found`);
        return null;
      }

      const { x, y, width, height } = zone;
      const croppedImage = await image.crop(x, y, width, height);
      return await croppedImage.toPng();

    } catch (error) {
      console.error(`Failed to capture ${zoneName} zone:`, error);
      return null;
    }
  }

  setupHotkey(): void {
    const { modifiers, key } = this.hotkeyConfig;

    this.gkl.addListener((e, down) => {
      if (e.state === 'DOWN' && e.name === key) {
        const ctrlPressed = modifiers.includes('ctrl') ? (down['LEFT CTRL'] || down['RIGHT CTRL']) : true;
        const shiftPressed = modifiers.includes('shift') ? (down['LEFT SHIFT'] || down['RIGHT SHIFT']) : true;
        const altPressed = modifiers.includes('alt') ? (down['LEFT ALT'] || down['RIGHT ALT']) : true;

        if (ctrlPressed && shiftPressed && altPressed) {
          console.log('Capture hotkey pressed');
          this.emit('captureRequested');
        }
      }
    });
  }
}

export { CaptureManager, CaptureResult };
