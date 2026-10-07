import { useEffect, useRef, useState } from 'react';

interface ConfirmButtonProps {
  /** Text on the first button, e.g. "Delete". */
  label: string;
  /** Accessible name for the first button when the visible label is ambiguous. */
  ariaLabel?: string;
  /** The question shown on the confirm step, e.g. "Delete this shirt?" */
  question: string;
  /** Text on the destructive confirm button, e.g. "Yes, delete". */
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  busyLabel?: string;
  disabled?: boolean;
}

/** A two-step destructive action: click once to ask, then confirm or keep. */
export function ConfirmButton({
  label,
  ariaLabel,
  question,
  confirmLabel,
  onConfirm,
  busyLabel = 'Deleting…',
  disabled = false,
}: ConfirmButtonProps) {
  const [step, setStep] = useState<'idle' | 'asking' | 'busy'>('idle');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (step === 'asking') {
      confirmRef.current?.focus();
      wasAsking.current = true;
    } else if (step === 'idle' && wasAsking.current) {
      triggerRef.current?.focus();
      wasAsking.current = false;
    }
  }, [step]);

  if (step === 'idle') {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--small btn--danger-quiet"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setStep('asking')}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="confirm" role="group" aria-label={question}>
      <span className="confirm__q">{question}</span>
      <button
        ref={confirmRef}
        type="button"
        className="btn btn--small btn--danger"
        disabled={step === 'busy'}
        onClick={async () => {
          setStep('busy');
          try {
            await onConfirm();
          } finally {
            // The row may unmount on success; setting state then is a harmless no-op in React 19.
            setStep('idle');
          }
        }}
      >
        {step === 'busy' ? busyLabel : confirmLabel}
      </button>
      <button
        type="button"
        className="btn btn--small btn--ghost"
        disabled={step === 'busy'}
        onClick={() => setStep('idle')}
      >
        Keep it
      </button>
    </span>
  );
}
