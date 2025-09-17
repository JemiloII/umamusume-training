import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { BrowserWindow } from 'electron';
import config from '../config.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  constructor() {
    this.config = config;
    console.log('Overlay manager ready');
  }

  async createOverlayWindow(windowInfo: WindowInfo): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      x: windowInfo.window.x,
      y: windowInfo.window.y,
      width: windowInfo.window.width,
      height: windowInfo.window.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      focusable: false,
      show: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });
    win.setIgnoreMouseEvents(true);
    return win;
  }

  generateChoicesHTML(): string {
    if (!this.currentChoices || this.currentChoices.length === 0) {
      return `<div class="choice_instruction">Press the hotkey: "${this.config.hotkey}" to display choice values.</div>`;
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
        }`;

    const templatePath = path.join(__dirname, 'overlay-template.html');
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
    if (this.window) {
      this.window.close();
    }

    this.currentWindowInfo = windowInfo;
    this.window = await this.createOverlayWindow(windowInfo);
    const html = await this.generateHTML(windowInfo);

    const htmlPath = path.join(__dirname, 'overlay.html');
    await fs.writeFile(htmlPath, html);
    await new Promise(resolve => setTimeout(resolve, 10));

    await this.window.loadFile(htmlPath);
    this.window.show();

    console.log('Overlay shown');
  }

  async updateWindowPosition(windowInfo: WindowInfo): Promise<void> {
    if (!this.window) return;

    this.currentWindowInfo = windowInfo;
    this.window.setPosition(windowInfo.window.x, windowInfo.window.y);
    this.window.setSize(windowInfo.window.width, windowInfo.window.height);

    const html = await this.generateHTML(windowInfo);
    const htmlPath = path.join(__dirname, 'overlay.html');
    await fs.writeFile(htmlPath, html);
    await this.window.loadFile(htmlPath);
  }

  async updateChoices(choices: Choice[]): Promise<void> {
    this.currentChoices = choices;

    if (!this.window || !this.currentWindowInfo) {
      console.log('No overlay window or window info available to update choices');
      return;
    }

    try {
      const html = await this.generateHTML(this.currentWindowInfo);
      const htmlPath = path.join(__dirname, 'overlay.html');
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
      const htmlPath = path.join(__dirname, 'overlay.html');
      await fs.writeFile(htmlPath, html);
      await this.window.loadFile(htmlPath);

      console.log(`Choice values ${visible ? 'shown' : 'hidden'}`);
    } catch (error) {
      console.error('Failed to update choice values visibility:', error);
    }
  }

  hideOverlay(): void {
    if (this.window) {
      this.window.hide();
      console.log('Overlay hidden');
    }
  }

  showOverlayWindow(): void {
    if (this.window) {
      this.window.show();
      console.log('Overlay shown');
    }
  }
}

export { OverlayManager };
