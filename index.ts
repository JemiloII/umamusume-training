import { app, Tray, Menu, nativeImage } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CaptureManager } from './src/capture.js';
import { OverlayManager } from './src/overlay.js';
import { WindowTracker, WindowInfo } from './src/window.js';
import { AnalysisManager, Choice } from './src/analysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class App {
  windowTracker: WindowTracker;
  overlayManager: OverlayManager;
  captureManager: CaptureManager;
  analysisManager: AnalysisManager;
  tray: Tray | null = null;

  constructor() {
    this.windowTracker = new WindowTracker();
    this.overlayManager = new OverlayManager();
    this.captureManager = new CaptureManager();
    this.analysisManager = new AnalysisManager(this.windowTracker, this.captureManager);

    this.setupTray();
    this.setupEventListeners();
    console.log('Starting application...');
    console.log('All systems active');
  }

  setupTray(): void {
    const iconPath = join(__dirname, 'images', 'haru.ico');
    this.tray = new Tray(nativeImage.createFromPath(iconPath));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Overlay',
        click: () => {
          this.overlayManager.showOverlayWindow();
        }
      },
      {
        label: 'Hide Overlay',
        click: () => {
          this.overlayManager.hideOverlay();
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          this.cleanup();
          app.quit();
        }
      }
    ]);

    this.tray.setToolTip('Umamusume Training Assistant');
    this.tray.setContextMenu(contextMenu);

    this.tray.on('click', () => {
      this.overlayManager.showOverlayWindow();
    });
  }

  cleanup(): void {
    this.overlayManager.destroy();
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  setupEventListeners(): void {
    this.windowTracker.on('windowFound', (windowInfo: WindowInfo) => {
      this.overlayManager.showOverlay(windowInfo);

      setTimeout(() => {
        if (this.windowTracker.getWindowState().isCareerProfileActive) {
          console.log('Window restored - showing choice values');
          this.overlayManager.setChoiceValuesVisibility({ visible: true, blur: false });
        }
      }, 250);
    });

    this.windowTracker.on('windowMoved', (windowInfo: WindowInfo) => {
      this.overlayManager.updateWindowPosition(windowInfo);
    });

    this.windowTracker.on('windowHidden', () => {
      this.overlayManager.hideOverlay();
    });

    this.windowTracker.on('windowFocused', () => {
      this.overlayManager.showOverlayWindow();
    });

    this.windowTracker.on('windowUnfocused', () => {
      this.overlayManager.hideOverlay();
    });

    this.windowTracker.on('career_profile', async ({ active }: { active: boolean }) => {
      console.log(`Career profile page is ${active ? 'active - showing' :  'inactive - hiding'} choice values`);
      if (active) {
        await this.analysisManager.detectUmamusume();
      }
      await this.overlayManager.setChoiceValuesVisibility({ visible: active });
    });

    this.windowTracker.on('menu', ({ blur }: { blur: boolean }) =>
      this.overlayManager.setChoiceValuesVisibility({ blur }));

    this.captureManager.on('captureRequested', () => {
      console.log('Capture completed, starting analysis...');
      this.analysisManager.analyzeEvent();
    });

    this.captureManager.on('captureError', (error: Error) => {
      console.error('Capture failed:', error);
    });

    this.analysisManager.on('analysisStarted', () => {
      console.log('AI analysis started...');
    });

    this.analysisManager.on('analysisComplete', (choices: Choice[]) => {
      console.log('Analysis completed, updating overlay...');
      this.overlayManager.updateChoices(choices);
    });

    this.analysisManager.on('analysisError', (error: Error) => {
      console.error('Analysis failed:', error);
    });

    this.analysisManager.on('umamusumeDetected', (characterName: string) => {
      console.log(`Umamusume updated to: ${characterName}`);
    });

    this.analysisManager.on('umamusumeDetectionError', (error: Error) => {
      console.error('Umamusume detection failed:', error);
    });
  }
}

let appInstance: App | undefined;

function createApp(): void {
  appInstance = new App();

  app.on('before-quit', () => {
    if (appInstance) {
      appInstance.cleanup();
    }
  });
}

// Disable hardware acceleration for better overlay performance
app.disableHardwareAcceleration();

app.setAppUserModelId("umamusume-training");
app.on('ready', () => {
  setTimeout(
    createApp,
    process.platform === 'linux' ? 1000 : 0 // https://github.com/electron/electron/issues/16809
  );
});

// Don't quit when all windows are closed - keep running in tray
app.on('window-all-closed', () => {
  // Do nothing - keep app running in tray
});

app.on('activate', () => {
  if (process.platform === 'darwin' && !appInstance) {
    createApp();
  }
});

process.on('unhandledRejection', () => {});
