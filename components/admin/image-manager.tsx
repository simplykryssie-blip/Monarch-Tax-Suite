"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  removeProductImageAction,
  setPrimaryImageAction,
  updateImageAltAction,
  uploadProductImageAction,
  type ImageActionState,
} from "@/app/(admin)/product-actions";

export type ManagedImage = { id: string; url: string; alt: string | null; is_primary: boolean; width: number | null; height: number | null; size_bytes: number };

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 4 * 1024 * 1024; // matches lib/commerce/images.ts (checked again on the server)

function checkFile(file: File | undefined): string | null {
  if (!file) return "Choose an image.";
  if (!ACCEPT.split(",").includes(file.type)) return "Upload a JPG, JPEG, PNG, or WebP image.";
  if (file.size > MAX_BYTES) return "Images must be 4 MB or smaller.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

/** File picker with a local preview before anything is uploaded. */
function UploadForm({ productId, replace, onDone }: { productId: string; replace?: ManagedImage; onDone?: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ImageActionState, FormData>(async (prev, form) => {
    const result = await uploadProductImageAction(prev, form);
    if (result.ok) {
      formRef.current?.reset();
      setPreview(null);
      onDone?.();
    }
    return result;
  }, {});

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const problem = checkFile(file);
    setError(problem);
    setPreview(file && !problem ? URL.createObjectURL(file) : null);
    if (problem) e.target.value = "";
  }

  return (
    <form ref={formRef} action={action} className="im-upload" onSubmit={(e) => { if (!preview) { e.preventDefault(); setError("Choose an image."); } }}>
      <input type="hidden" name="product_id" value={productId} />
      {replace && <input type="hidden" name="replace_id" value={replace.id} />}
      <label className="im-pick">
        <span>{replace ? "Choose replacement image" : "Choose image"}</span>
        <input type="file" name="file" accept={ACCEPT} onChange={onPick} />
      </label>
      {preview && (
        <div className="im-pending">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt="Selected image preview" />
          {!replace && <input name="alt_text" maxLength={200} placeholder="Alt text (describe the image)" />}
          <button className="monarch-primary" type="submit" disabled={pending}>{pending ? "Uploading…" : replace ? "Replace image" : "Upload image"}</button>
          <button className="monarch-secondary" type="button" disabled={pending} onClick={() => { formRef.current?.reset(); setPreview(null); }}>Cancel</button>
        </div>
      )}
      {(error || (state.ok === false && state.message)) && <p className="monarch-alert is-error" role="alert">{error ?? state.message}</p>}
      {state.ok && state.message && <p className="monarch-alert" role="status">{state.message}</p>}
      <small className="monarch-muted">JPG, PNG or WebP · up to 4 MB · the file type is verified from its contents.</small>
    </form>
  );
}

function ImageCard({ productId, image }: { productId: string; image: ManagedImage }) {
  const [primaryState, primary, primaryPending] = useActionState<ImageActionState, FormData>(setPrimaryImageAction, {});
  const [removeState, remove, removePending] = useActionState<ImageActionState, FormData>(removeProductImageAction, {});
  const [altState, saveAlt, altPending] = useActionState<ImageActionState, FormData>(updateImageAltAction, {});
  const [replacing, setReplacing] = useState(false);
  const message = [primaryState, removeState, altState].find((s) => s.ok === false)?.message;

  return (
    <li className="im-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- storage URL */}
      <img src={image.url} alt={image.alt ?? ""} />
      <div className="im-meta">
        {image.is_primary ? <span className="monarch-badge published">Primary</span> : (
          <form action={primary}><input type="hidden" name="image_id" value={image.id} /><button className="monarch-secondary" disabled={primaryPending}>Make primary</button></form>
        )}
        <small>{image.width && image.height ? `${image.width}×${image.height} · ` : ""}{kb(image.size_bytes)}</small>
      </div>
      <form action={saveAlt} className="im-alt">
        <input type="hidden" name="image_id" value={image.id} />
        <input name="alt_text" maxLength={200} defaultValue={image.alt ?? ""} placeholder="Alt text" aria-label="Alt text" />
        <button className="monarch-secondary" disabled={altPending}>Save</button>
      </form>
      <div className="monarch-inline-actions">
        <button className="monarch-secondary" type="button" onClick={() => setReplacing((r) => !r)}>{replacing ? "Cancel replace" : "Replace"}</button>
        <form action={remove} onSubmit={(e) => { if (!window.confirm("Remove this image? The file is deleted from storage.")) e.preventDefault(); }}>
          <input type="hidden" name="image_id" value={image.id} />
          <button className="monarch-secondary is-danger" disabled={removePending}>{removePending ? "Removing…" : "Remove"}</button>
        </form>
      </div>
      {replacing && <UploadForm productId={productId} replace={image} onDone={() => setReplacing(false)} />}
      {message && <p className="monarch-alert is-error" role="alert">{message}</p>}
    </li>
  );
}

export function ImageManager({ productId, images, readOnly, max }: { productId: string; images: ManagedImage[]; readOnly: boolean; max: number }) {
  return (
    <section className="monarch-panel monarch-pad">
      <h2 className="monarch-h2">Product images</h2>
      <p className="monarch-muted">The primary image is shown first on the storefront and in the product list. Images are stored in Supabase Storage; only administrators can upload, replace or remove them.</p>
      {images.length === 0 ? <p className="im-empty">No images yet. The storefront shows a Monarch placeholder until one is uploaded.</p> : (
        <ul className="im-grid">{images.map((img) => readOnly ? (
          <li key={img.id} className="im-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- storage URL */}
            <img src={img.url} alt={img.alt ?? ""} />
          </li>
        ) : <ImageCard key={img.id} productId={productId} image={img} />)}</ul>
      )}
      {readOnly ? <p className="monarch-muted">Archived products are read-only.</p> : images.length < max ? <UploadForm productId={productId} /> : <p className="monarch-muted">Maximum of {max} images reached. Remove or replace one to add another.</p>}
    </section>
  );
}
