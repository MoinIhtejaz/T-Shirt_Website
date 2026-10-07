import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_PRODUCT } from '../../../contracts/types';
import type { ProductImage } from '../../../contracts/types';
import { adminApi } from '../lib/api/endpoints';
import { ConfirmButton } from '../components/ConfirmButton';
import { errorMessage } from '../components/States';
import { ArrowDown, ArrowUp } from '../components/Icons';
import { useHandleUnauthorized } from './RequireAdmin';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ACCEPTED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

function sortImages(images: ProductImage[]): ProductImage[] {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side pre-check. The server re-checks everything by file content. */
export function precheckImage(file: File, currentCount: number): string | null {
  if (currentCount >= MAX_IMAGES_PER_PRODUCT) {
    return `This shirt already has ${MAX_IMAGES_PER_PRODUCT} photos, the most allowed. Delete one to add another.`;
  }
  const typeOk = file.type ? ACCEPTED_IMAGE_TYPES.includes(file.type) : ACCEPTED_EXTENSIONS.test(file.name);
  if (!typeOk) return 'That file type is not supported. Use a JPEG, PNG or WebP image.';
  if (file.size > MAX_IMAGE_BYTES) {
    return `That photo is ${formatBytes(file.size)}. The limit is 5 MB, so resize it and try again.`;
  }
  if (file.size === 0) return 'That file is empty. Choose another photo.';
  return null;
}

function ImageRow({
  productId,
  image,
  index,
  total,
  busy,
  onMove,
  onUpdated,
  onDeleted,
  onError,
}: {
  productId: number;
  image: ProductImage;
  index: number;
  total: number;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onUpdated: (img: ProductImage) => void;
  onDeleted: (id: number) => void;
  onError: (err: unknown) => string | null;
}) {
  const id = useId();
  const [alt, setAlt] = useState(image.alt);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const changed = alt.trim() !== image.alt;

  useEffect(() => setAlt(image.alt), [image.alt]);

  async function saveAlt(e: FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setSaving(true);
    setStatus(null);
    try {
      const updated = await adminApi.updateImage(productId, image.id, { alt: alt.trim() });
      onUpdated(updated);
      setStatus({ kind: 'ok', text: 'Alt text saved.' });
    } catch (err) {
      const text = onError(err);
      if (text) setStatus({ kind: 'error', text });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setStatus(null);
    try {
      await adminApi.deleteImage(productId, image.id);
      onDeleted(image.id);
    } catch (err) {
      const text = onError(err);
      if (text) setStatus({ kind: 'error', text });
    }
  }

  const label = `Photo ${index + 1}`;

  return (
    <li className="image-row">
      <img className="image-row__thumb" src={image.url} alt="" />
      <div className="image-row__body">
        <p className="image-row__label">
          {label}
          {index === 0 ? <span className="badge badge--main">Main photo</span> : null}
        </p>
        <form className="image-row__alt" onSubmit={saveAlt} noValidate>
          <label htmlFor={`${id}-alt`}>Alt text for {label.toLowerCase()}</label>
          <div className="cat-add__row">
            <input
              id={`${id}-alt`}
              value={alt}
              maxLength={200}
              onChange={(e) => setAlt(e.target.value)}
              aria-describedby={status ? `${id}-status` : undefined}
            />
            <button type="submit" className="btn btn--small btn--ghost" disabled={!changed || saving}>
              {saving ? 'Saving…' : 'Save alt text'}
            </button>
          </div>
        </form>
        {status ? (
          <p
            id={`${id}-status`}
            className={status.kind === 'ok' ? 'field__ok' : 'field__error'}
            role={status.kind === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </p>
        ) : null}
      </div>
      <div className="image-row__actions">
        <button
          type="button"
          className="btn btn--icon"
          aria-label={`Move ${label.toLowerCase()} up`}
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp width={18} height={18} />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          aria-label={`Move ${label.toLowerCase()} down`}
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown width={18} height={18} />
        </button>
        <ConfirmButton
          label="Delete"
          ariaLabel={`Delete ${label.toLowerCase()}`}
          question="Delete this photo?"
          confirmLabel="Yes, delete"
          onConfirm={remove}
          disabled={busy}
        />
      </div>
    </li>
  );
}

export function ImageManager({
  productId,
  productName,
  initialImages,
}: {
  productId: number;
  productName: string;
  initialImages: ProductImage[];
}) {
  const id = useId();
  const handle401 = useHandleUnauthorized();
  const [images, setImages] = useState(() => sortImages(initialImages));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [uploading, setUploading] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Revoke blob: preview URLs when they're replaced or the manager unmounts.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const full = images.length >= MAX_IMAGES_PER_PRODUCT;

  /** Returns the message to show, or null when the error was a 401 (already redirected). */
  function describe(err: unknown): string | null {
    if (handle401(err)) return null;
    return errorMessage(err);
  }

  function clearSelection() {
    setFile(null);
    setPreview(null);
    setAlt('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setUploadError(null);
    setNotice(null);
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      clearSelection();
      return;
    }
    const problem = precheckImage(picked, images.length);
    if (problem) {
      setUploadError(problem);
      setFile(null);
      setPreview(null);
      e.target.value = '';
      return;
    }
    setFile(picked);
    try {
      setPreview(URL.createObjectURL(picked));
    } catch {
      setPreview(null);
    }
  }

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      const created = await adminApi.uploadImage(productId, file, alt);
      setImages((list) => sortImages([...list, created]));
      clearSelection();
      setNotice({ kind: 'ok', text: 'Photo uploaded.' });
    } catch (err) {
      const text = describe(err);
      if (text) setUploadError(text);
    } finally {
      setUploading(false);
    }
  }

  async function move(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const changes = next.map((img, i) => ({ img, sortOrder: i })).filter(({ img, sortOrder }) => img.sortOrder !== sortOrder);

    setReordering(true);
    setNotice(null);
    setImages(next.map((img, i) => ({ ...img, sortOrder: i })));
    try {
      const saved = await Promise.all(
        changes.map(({ img, sortOrder }) => adminApi.updateImage(productId, img.id, { sortOrder })),
      );
      setImages((list) => sortImages(list.map((img) => saved.find((s) => s.id === img.id) ?? img)));
      setNotice({ kind: 'ok', text: `Moved photo ${from + 1} to position ${to + 1}.` });
    } catch (err) {
      const text = describe(err);
      if (text === null) return;
      setNotice({ kind: 'error', text: `The new order didn't save. ${text}` });
      // Re-sync with the server so the list shows the order it actually has.
      try {
        const fresh = await adminApi.getProduct(productId);
        setImages(sortImages(fresh.images));
      } catch {
        setImages(sortImages(images));
      }
    } finally {
      setReordering(false);
    }
  }

  return (
    <section className="admin-panel image-manager" aria-labelledby={`${id}-title`}>
      <div className="admin-panel__head">
        <h2 id={`${id}-title`} className="admin-subtitle">
          Photos
        </h2>
        <p className="admin-help">
          {images.length} of {MAX_IMAGES_PER_PRODUCT}. The first photo shows in the shop grid.
        </p>
      </div>

      <div aria-live="polite">
        {notice ? (
          <p className={`notice notice--${notice.kind === 'ok' ? 'success' : 'error'}`}>{notice.text}</p>
        ) : null}
      </div>

      {images.length === 0 ? (
        <p className="state state--empty state--compact">No photos yet. Upload one below so the shirt has something to show.</p>
      ) : (
        <ol className="image-list">
          {images.map((img, i) => (
            <ImageRow
              key={img.id}
              productId={productId}
              image={img}
              index={i}
              total={images.length}
              busy={reordering}
              onMove={move}
              onUpdated={(u) => setImages((list) => list.map((x) => (x.id === u.id ? u : x)))}
              onDeleted={(removed) => {
                setImages((list) => list.filter((x) => x.id !== removed));
                setNotice({ kind: 'ok', text: 'Photo deleted.' });
              }}
              onError={describe}
            />
          ))}
        </ol>
      )}

      <form className="upload" onSubmit={upload} noValidate>
        <h3 className="upload__title">Add a photo</h3>
        {full ? (
          <p className="field__hint">This shirt has the most photos allowed. Delete one to add another.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${id}-file`}>Photo file</label>
              <input
                ref={fileInput}
                id={`${id}-file`}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(',')}
                onChange={onPick}
                aria-invalid={uploadError ? true : undefined}
                aria-describedby={`${id}-file-hint${uploadError ? ` ${id}-file-err` : ''}`}
              />
              <p id={`${id}-file-hint`} className="field__hint">
                JPEG, PNG or WebP, up to 5 MB. A 4:5 portrait crop looks best.
              </p>
              {uploadError ? (
                <p id={`${id}-file-err`} className="field__error" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>

            {file ? (
              <div className="upload__preview">
                {preview ? <img src={preview} alt="Preview of the selected photo" /> : null}
                <div className="upload__fields">
                  <p className="upload__meta">
                    {file.name} · {formatBytes(file.size)}
                  </p>
                  <div className="field">
                    <label htmlFor={`${id}-alt`}>Alt text for the new photo</label>
                    <input
                      id={`${id}-alt`}
                      value={alt}
                      maxLength={200}
                      placeholder={productName}
                      onChange={(e) => setAlt(e.target.value)}
                      aria-describedby={`${id}-alt-hint`}
                    />
                    <p id={`${id}-alt-hint`} className="field__hint">
                      Describe the photo for people using screen readers. Leave blank to use the shirt name.
                    </p>
                  </div>
                  <div className="upload__actions">
                    <button type="submit" className="btn btn--admin-primary" disabled={uploading}>
                      {uploading ? 'Uploading…' : 'Upload photo'}
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={clearSelection} disabled={uploading}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </form>
    </section>
  );
}
