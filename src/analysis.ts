import { EventEmitter } from 'events';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import { findEvent } from './events.js';
import names from '../data/names.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Choice {
  choice: number;
  text?: string;
  success: string[];
  failure?: string[];
}

interface Config {
  hotkey: string;
  umamusume: string;
  debug: boolean;
  capture: any[];
  padding: {
    top: number;
    bottom: number;
  };
}

class AnalysisManager extends EventEmitter {
  config: Config;
  isProcessing: boolean;
  windowTracker: any;
  captureManager: any;

  constructor(windowTracker: any, captureManager: any) {
    super();
    this.config = JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
    this.isProcessing = false;
    this.windowTracker = windowTracker;
    this.captureManager = captureManager;
    console.log('Analysis manager ready');
  }

  async extractTextFromZone(zoneName: string): Promise<string | null> {
    try {
      const windowInfo = this.windowTracker.getCurrentWindow();
      const umamusumeWindow = this.windowTracker.umamusumeWindow;
      const imageBuffer = await this.captureManager.captureZone(zoneName, windowInfo, umamusumeWindow);
      if (!imageBuffer) return null;

      const worker = await createWorker('eng', 1, { logger() {} });
      const { data: { text } } = await worker.recognize(imageBuffer);
      await worker.terminate();

      return text.trim() || '';
    } catch (error) {
      console.error(`OCR error for ${zoneName}:`, error);
      return null;
    }
  }

  parseEventType(rawText: string): string {
    const text = rawText.toLowerCase();
    if (text.includes('trainee')) return 'Trainee';
    if (text.includes('support')) return 'Support';
    if (text.includes('scenario')) return 'Scenario';
    return 'Scenario';
  }

  async analyzeEvent(): Promise<Choice[] | null> {
    if (this.isProcessing) {
      console.log('Analysis already in progress, skipping...');
      return null;
    }

    this.isProcessing = true;
    this.emit('analysisStarted');

    try {
      const titleText = await this.extractTextFromZone('event_title');
      const typeText = await this.extractTextFromZone('event_type');

      if (!titleText || !typeText) {
        console.log('Failed to extract event text');
        return null;
      }

      const eventData = {
        title: titleText,
        type: this.parseEventType(typeText),
        uma: this.config.umamusume
      };

      const choices = await findEvent(eventData);
      this.emit('analysisComplete', choices);
      return choices;
    } catch (error) {
      console.error('Analysis error:', error);
      this.emit('analysisError', error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }

  async detectUmamusume(): Promise<string | null> {
    if (this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    this.emit('umamusumeDetectionStarted');

    try {
      const text = await this.extractTextFromZone('umamusume');
      if (!text) {
        console.log('No text extracted from umamusume zone');
        return null;
      }

      const characterName = text.trim();
      if (!names.some(name => name === characterName)) {
        console.log('Failed to find Umamusume, attempting again.');
        this.isProcessing = false;
        return await this.detectUmamusume();
      }

      this.config.umamusume = characterName;
      writeFileSync(join(__dirname, '../config.json'), JSON.stringify(this.config, null, 2));

      this.emit('umamusumeDetected', characterName);
      return characterName;

    } catch (error) {
      console.error('Umamusume detection error:', error);
      this.emit('umamusumeDetectionError', error);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }
}

export { AnalysisManager, Choice };
