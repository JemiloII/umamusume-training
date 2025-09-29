import { app } from 'electron';
import { CaptureManager } from './src/capture.js';
import { OverlayManager } from './src/overlay.js';
import { WindowTracker, WindowInfo } from './src/window.js';
import { AnalysisManager, Choice } from './src/analysis.js';

class App {
  windowTracker: WindowTracker;
  overlayManager: OverlayManager;
  captureManager: CaptureManager;
  analysisManager: AnalysisManager;

  constructor() {
    this.windowTracker = new WindowTracker();
    this.overlayManager = new OverlayManager();
    this.captureManager = new CaptureManager();
    this.analysisManager = new AnalysisManager(this.windowTracker, this.captureManager);

    this.setupEventListeners();
    console.log('Starting application...');
    console.log('All systems active');
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
    if (appInstance?.overlayManager.window) {
      appInstance.overlayManager.window.destroy();
      appInstance.overlayManager.window = null as any;
    }
  });
}

app.setAppUserModelId("umamusume-training");
app.on('ready', createApp);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (process.platform === 'darwin') {
    createApp();
  }
});

process.on('unhandledRejection', () => {});
