import { mediaKind } from './backgroundTimeline';
import { withUploads, type RenderSpec } from './serverRender';

/**
 * A server render as the request that submits it: the spec, the recording
 * and each uploaded background.
 *
 * Built in the browser because that is where the files are. The recording
 * goes as a file even when it came from a reciter's server: the tab already
 * has it, the upload is to this machine, and a server that fetched addresses
 * a browser handed it would be a way to make it fetch anything.
 */
export async function buildRenderForm(
  spec: Omit<RenderSpec, 'media'>,
  audioSrc: string
): Promise<FormData> {
  const { config, uploads } = withUploads(spec.config, mediaKind);
  // Resolved against this page: a reciter's recording is the studio's relative proxy url.
  const sources = [audioSrc, ...uploads.map(upload => upload.url)].map(src => new URL(src, window.location.href));
  const [audio, ...backgrounds] = await Promise.all(sources.map(async url => (await fetch(url)).blob()));
  const form = new FormData();
  form.append('audio', audio, 'audio');
  uploads.forEach((upload, i) => form.append(upload.media.name, backgrounds[i], upload.media.name));
  const full: RenderSpec = { ...spec, config, media: uploads.map(upload => upload.media) };
  // A Blob rather than a string field, so the multipart encoder leaves it byte for byte.
  form.append('spec', new Blob([JSON.stringify(full)], { type: 'application/json' }));
  return form;
}
