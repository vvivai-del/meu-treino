// PROVISÓRIO: substituir pela implementação real.
import { AIError, type CatalogEntry, type ParsedWorkout, type UploadedVideo, type VideoSegment } from './index';

export async function parseWorkoutText(_text: string, _catalog: CatalogEntry[]): Promise<ParsedWorkout> {
  throw new AIError('Ainda não implementado', 'outro');
}

export async function uploadVideo(_file: Blob, _onProgress?: (fraction: number) => void): Promise<UploadedVideo> {
  throw new AIError('Ainda não implementado', 'outro');
}

export async function locateSegments(
  _video: UploadedVideo,
  _items: Array<{ key: string; name: string }>,
): Promise<VideoSegment[]> {
  throw new AIError('Ainda não implementado', 'outro');
}
