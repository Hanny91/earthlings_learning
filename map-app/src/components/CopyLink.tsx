import { useState } from 'react';

/** A read-only link with a Copy button, for sending invite links by hand. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(input: HTMLInputElement | null) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; select the text so it can be copied by hand.
      input?.select();
    }
  }

  return (
    <div className="copy-link">
      <input
        type="text"
        readOnly
        value={url}
        aria-label="Invite link"
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className="button button--small"
        onClick={(e) => copy(e.currentTarget.previousElementSibling as HTMLInputElement | null)}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
