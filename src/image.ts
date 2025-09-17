import sharp from 'sharp';
import fs from 'fs/promises';

interface ImageComparisonResult {
  similarity: number;
  isMatch: boolean;
  threshold: number;
}

interface ImageMetadata {
  width: number;
  height: number;
  channels: number;
  hasAlpha: boolean;
  format: string;
}

class ImageProcessor {
  private static readonly DEFAULT_SIMILARITY_THRESHOLD = 0.55;
  private static readonly DEFAULT_TOLERANCE = 30;
  private static readonly COMPARISON_SIZE = 200;

  static async compareImageSimilarity(
    referenceImagePath: string,
    croppedImageBuffer: Buffer,
    threshold: number = ImageProcessor.DEFAULT_SIMILARITY_THRESHOLD
  ): Promise<boolean> {
    try {
      const referenceBuffer = await sharp(referenceImagePath).toBuffer();
      const result = await ImageProcessor.compareImageBuffers(referenceBuffer, croppedImageBuffer, threshold);

      return result.isMatch;
    } catch (error) {
      console.error('Error comparing images:', error);
      return false;
    }
  }

  static async compareImageBuffers(
    buffer1: Buffer,
    buffer2: Buffer,
    threshold: number = ImageProcessor.DEFAULT_SIMILARITY_THRESHOLD
  ): Promise<ImageComparisonResult> {
    // Normalize both images to be the same size
    const [image1, image2] = await Promise.all([
      sharp(buffer1).resize(ImageProcessor.COMPARISON_SIZE, ImageProcessor.COMPARISON_SIZE).raw().toBuffer(),
      sharp(buffer2).resize(ImageProcessor.COMPARISON_SIZE, ImageProcessor.COMPARISON_SIZE).raw().toBuffer()
    ]);

    const similarity = ImageProcessor.calculateSimilarity(image1, image2);

    return {
      similarity,
      isMatch: similarity > threshold,
      threshold
    };
  }

  static calculateSimilarity(buffer1: Buffer, buffer2: Buffer, tolerance: number = ImageProcessor.DEFAULT_TOLERANCE): number {
    if (buffer1.length !== buffer2.length) {
      console.warn('Buffer lengths do not match, similarity may be inaccurate');
      return 0;
    }

    let matches = 0;
    const pixelCount = buffer1.length / 3;

    for (let i = 0; i < buffer1.length; i += 3) {
      const diff = Math.abs(buffer1[i] - buffer2[i]) +
        Math.abs(buffer1[i + 1] - buffer2[i + 1]) +
        Math.abs(buffer1[i + 2] - buffer2[i + 2]);

      if (diff <= tolerance) matches++;
    }

    return matches / pixelCount;
  }

  static async getImageMetadata(imagePath: string): Promise<ImageMetadata> {
    const metadata = await sharp(imagePath).metadata();

    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      channels: metadata.channels || 0,
      hasAlpha: metadata.hasAlpha || false,
      format: metadata.format || 'unknown'
    };
  }

  static async cropImage(imagePath: string, x: number, y: number, width: number, height: number): Promise<Buffer> {
    return await sharp(imagePath)
      .extract({ left: x, top: y, width, height })
      .toBuffer();
  }

  static async resizeImage(imagePath: string, width: number, height: number): Promise<Buffer> {
    return await sharp(imagePath)
      .resize(width, height)
      .toBuffer();
  }

  static async convertToFormat(imagePath: string, format: 'png' | 'jpg' | 'webp'): Promise<Buffer> {
    const processor = sharp(imagePath);

    switch (format) {
      case 'png':
        return await processor.png().toBuffer();
      case 'jpg':
        return await processor.jpeg().toBuffer();
      case 'webp':
        return await processor.webp().toBuffer();
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  static async saveBuffer(buffer: Buffer, outputPath: string): Promise<void> {
    await fs.writeFile(outputPath, buffer);
  }

  static async enhanceImage(imagePath: string, options: {
    brightness?: number;
    contrast?: number;
    sharpen?: boolean;
  } = {}): Promise<Buffer> {
    let processor = sharp(imagePath);

    if (options.brightness !== undefined) {
      processor = processor.modulate({ brightness: options.brightness });
    }

    if (options.contrast !== undefined) {
      processor = processor.linear(options.contrast, 0);
    }

    if (options.sharpen) {
      processor = processor.sharpen();
    }

    return await processor.toBuffer();
  }
}

// Export both the class and individual functions for backward compatibility
export { ImageProcessor };
export const compareImageSimilarity = ImageProcessor.compareImageSimilarity;
