import { useState } from 'react';

interface CopyTextProps {
  text: string;
  /** Accessible name for the text box, e.g. "Invite message". */
  label: string;
}

/**
 * Read-only text with a Copy button, for things sent by hand such as invite
 * messages. Text with line breaks gets a multi-line box.
 */
export function CopyText({ text, label }: CopyTextProps) {
  const [copied, setCopied] = useState(false);
  const multiline = text.includes('\n');

  async function copy(field: HTMLInputElement | HTMLTextAreaElement | null) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; select the text so it can be copied by hand.
      field?.select();
    }
  }

  const fieldProps = {
    readOnly: true,
    value: text,
    'aria-label': label,
    onFocus: (e: { target: HTMLInputElement | HTMLTextAreaElement }) => e.target.select(),
  };

  return (
    <div className={multiline ? 'copy-text copy-text--multiline' : 'copy-text'}>
      {multiline ? <textarea rows={8} {...fieldProps} /> : <input type="text" {...fieldProps} />}
      <button
        type="button"
        className="button button--small"
        onClick={(e) =>
          copy(e.currentTarget.previousElementSibling as HTMLInputElement | HTMLTextAreaElement | null)
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
