import { dirname, join } from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { BrowserWindow, globalShortcut } from 'electron';
import { OverlayController, OVERLAY_WINDOW_OPTS } from 'electron-overlay-window';
import config from '../config.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Choice {
  choice: number;
  text?: string;
  success: string[];
  failure?: string[];
}

interface WindowInfo {
  window: {
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    appName: string;
    visible: boolean;
  };
  captures: Array<{
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    absoluteX: number;
    absoluteY: number;
  }>;
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

class OverlayManager {
  window: BrowserWindow | null = null;
  currentChoices: Choice[] = [];
  currentWindowInfo: WindowInfo | null = null;
  config: Config;
  blurChoiceValues: boolean = false;
  showChoiceValues: boolean = false;
  isInteractable: boolean = false;
  isAttached: boolean = false;

  constructor() {
    this.config = config;
    this.setupGlobalShortcuts();
    console.log('Overlay manager ready');
  }

  setupGlobalShortcuts(): void {
    // Register global shortcut for toggling overlay interactivity
    const toggleInteractKey = 'CmdOrCtrl+Shift+O';
    globalShortcut.register(toggleInteractKey, () => {
      this.toggleOverlayInteraction();
    });

    // Register the configured hotkey for capturing
    if (this.config.hotkey) {
      globalShortcut.register(this.config.hotkey, () => {
        console.log('Hotkey pressed - triggering capture');
        // This will be handled by the existing capture logic
      });
    }
  }

  toggleOverlayInteraction(): void {
    if (!this.window || !this.isAttached) return;

    if (this.isInteractable) {
      this.isInteractable = false;
      OverlayController.focusTarget();
      this.window.webContents.send('focus-change', false);
      console.log('Overlay interaction disabled - click through enabled');
    } else {
      this.isInteractable = true;
      OverlayController.activateOverlay();
      this.window.webContents.send('focus-change', true);
      console.log('Overlay interaction enabled - can click overlay elements');
    }
  }

  async createOverlayWindow(windowInfo: WindowInfo): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      title: 'Umamusume Training Overlay',
      icon: join(__dirname, '../images/haru.ico'),
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      ...OVERLAY_WINDOW_OPTS
    });

    // Handle window blur events
    win.on('blur', () => {
      this.isInteractable = false;
      win.webContents.send('focus-change', false);
    });

    // Generate and load initial overlay content
    const html = await this.generateHTML(windowInfo);
    const htmlPath = join(__dirname, 'overlay.html');
    await fs.writeFile(htmlPath, html);
    
    // Small delay to ensure file is written
    await new Promise(resolve => setTimeout(resolve, 50));
    await win.loadFile(htmlPath);

    // Setup IPC listeners for overlay interactions
    win.webContents.executeJavaScript(`
      const { ipcRenderer } = require('electron');
      
      ipcRenderer.on('focus-change', (event, focused) => {
        document.body.classList.toggle('interactable', focused);
        if (focused) {
          console.log('Overlay is now interactable');
        } else {
          console.log('Overlay is now click-through');
        }
      });

      ipcRenderer.on('visibility-change', (event, visible) => {
        document.body.style.opacity = visible ? '1' : '0';
      });
    `);

    return win;
  }

  generateChoicesHTML(): string {
    if (!this.currentChoices || this.currentChoices.length === 0) {
      return `<div class="choice_instruction">Press the hotkey: "${this.config.hotkey}" to display choice values.<br>Press Ctrl+Shift+O to toggle overlay interaction.</div>`;
    }

    const choiceColors = ['choice_green', 'choice_yellow', 'choice_pink'];

    return this.currentChoices.map((choice, index) => {
      const colorClass = choiceColors[index];
      const successText = choice.success.join(' ');
      const failureText = choice.failure && choice.failure.length > 0
        ? choice.failure.join(' ')
        : '';

      return `
        <div class="choice_item ${colorClass}">
          <div>${successText}</div>
          ${failureText ? `<div class="choice_failure">${failureText}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  async generateHTML(windowInfo: WindowInfo, blur = this.blurChoiceValues, showChoiceValues = this.showChoiceValues): Promise<string> {
    const overlayElements = this.config.debug ? windowInfo.captures.map(capture =>
      `<div class="overlay ${capture.name}" data-name="${capture.name}"></div>`
    ).join('\n') : '';

    const infoElements = this.config.debug ? windowInfo.captures.map(capture =>
      `${capture.name}: ${capture.width}x${capture.height}`
    ).join('<br>\n') : '';

    const choiceValuesCapture = windowInfo.captures.find(capture => capture.name === 'choice_values');
    const choiceWidth = choiceValuesCapture?.width || 765;
    const headerWidth = choiceWidth;
    const headerHeight = Math.floor(choiceWidth * (28 / 779));

    const captureCSS = windowInfo.captures.map(capture => `
        .${capture.name} {
            left: ${capture.x}px;
            top: ${capture.y}px;
            width: ${capture.width}px;
            height: ${capture.height}px;
        }`).join('') + `
        
        .choice_header {
            width: ${headerWidth}px !important;
            height: ${headerHeight}px !important;
        }

        /* Add styles for interactable overlay */
        body.interactable {
            pointer-events: auto !important;
        }
        
        body:not(.interactable) {
            pointer-events: none !important;
        }

        .choice_item {
            pointer-events: auto;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .choice_item:hover {
            transform: scale(1.02);
            opacity: 0.9;
        }`;

    const templatePath = join(__dirname, 'overlay-template.html');
    let template = await fs.readFile(templatePath, 'utf8');

    const choiceValuesStyle = showChoiceValues ? '' : ' style="display: none;"';
    const blurred = blur ? ' blur' : '';
    template = template.replace('<div class="choice_values">', `<div class="choice_values${blurred}"${choiceValuesStyle}>`);

    template = template.replace('<style id="dynamic-css">', `<style id="dynamic-css">\n${captureCSS}`);
    template = template.replace('<!-- Debug overlay boxes will be injected here -->', overlayElements);
    template = template.replace('<!-- Debug info will be injected here -->', infoElements);
    template = template.replace('<!-- Choice items will be injected here -->', this.generateChoicesHTML());

    if (!this.config.debug) {
      template = template.replace('class="info"', 'class="info hidden"');
    }
    return template;
  }

  async showOverlay(windowInfo: WindowInfo): Promise<void> {
    try {
      this.currentWindowInfo = windowInfo;

      if (!this.window) {
        this.window = await this.createOverlayWindow(windowInfo);
      }

      // Attach to the target window if not already attached
      if (!this.isAttached) {
        try {
          // Try to attach to the Umamusume window by title
          OverlayController.attachByTitle(
            this.window,
            windowInfo.window.title,
            { hasTitleBarOnMac: true }
          );
          this.isAttached = true;
          console.log(`Overlay attached to window: ${windowInfo.window.title}`);
        } catch (error) {
          console.error('Failed to attach overlay to window:', error);
          // Fall back to showing the window normally
          this.window.show();
        }
      }

      console.log('Overlay shown');
    } catch (error) {
      console.error('Failed to show overlay:', error);
    }
  }

  async updateWindowPosition(windowInfo: WindowInfo): Promise<void> {
    // The electron-overlay-window package handles window positioning automatically
    // We just need to update our internal state and refresh content if needed
    if (!this.window) return;

    this.currentWindowInfo = windowInfo;
    
    try {
      const html = await this.generateHTML(windowInfo);
      const htmlPath = join(__dirname, 'overlay.html');
      await fs.writeFile(htmlPath, html);
      await this.window.loadFile(htmlPath);
    } catch (error) {
      console.error('Failed to update window position:', error);
    }
  }

  async updateChoices(choices: Choice[]): Promise<void> {
    this.currentChoices = choices;

    if (!this.window || !this.currentWindowInfo) {
      console.log('No overlay window or window info available to update choices');
      return;
    }

    try {
      const html = await this.generateHTML(this.currentWindowInfo);
      const htmlPath = join(__dirname, 'overlay.html');
      await fs.writeFile(htmlPath, html);
      await this.window.loadFile(htmlPath);

      console.log('Choices updated in overlay');
    } catch (error) {
      console.error('Failed to update choices:', error);
    }
  }

  async setChoiceValuesVisibility({ blur = this.blurChoiceValues, visible = this.showChoiceValues }): Promise<void> {
    this.blurChoiceValues = blur;
    this.showChoiceValues = visible;
    
    if (!this.window || !this.currentWindowInfo) {
      return;
    }

    try {
      const html = await this.generateHTML(this.currentWindowInfo, blur, visible);
      const htmlPath = join(__dirname, 'overlay.html');
      await fs.writeFile(htmlPath, html);
      await this.window.loadFile(htmlPath);

      console.log(`Choice values ${visible ? 'shown' : 'hidden'}`);
    } catch (error) {
      console.error('Failed to update choice values visibility:', error);
    }
  }

  hideOverlay(): void {
    if (this.window) {
      this.window.webContents.send('visibility-change', false);
      console.log('Overlay hidden');
    }
  }

  showOverlayWindow(): void {
    if (this.window) {
      this.window.webContents.send('visibility-change', true);
      console.log('Overlay shown');
    }
  }

  destroy(): void {
    if (this.window) {
      this.window.destroy();
      this.window = null;
    }
    this.isAttached = false;
    this.isInteractable = false;
    
    // Unregister global shortcuts
    globalShortcut.unregisterAll();
  }
}

export { OverlayManager };
