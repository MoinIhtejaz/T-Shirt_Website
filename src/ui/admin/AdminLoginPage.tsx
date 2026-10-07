import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { isApiClientError } from '../lib/api/client';
import { authApi } from '../lib/api/endpoints';
import { Seo } from '../components/Seo';
import { BrandMark } from '../components/Icons';
import { BRAND } from '../content/copy';
import { toFieldErrorMap, type FieldErrorMap } from './fieldErrors';

interface LoginState {
  from?: string;
  expired?: boolean;
}

function safeReturnPath(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/admin') && !from.startsWith('/admin/login') ? from : '/admin';
}

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LoginState;
  const id = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;

    const local: FieldErrorMap = {};
    if (email.trim() === '') local.email = 'Enter your email address.';
    if (password === '') local.password = 'Enter your password.';
    setFieldErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    setPending(true);
    try {
      await authApi.login({ email: email.trim(), password });
      navigate(safeReturnPath(state.from), { replace: true });
    } catch (err) {
      setPending(false);
      if (!isApiClientError(err)) {
        setFormError('Something went wrong. Try again.');
        return;
      }
      switch (err.code) {
        case 'INVALID_CREDENTIALS':
          setFormError(err.message || 'Email or password is incorrect.');
          setPassword('');
          break;
        case 'RATE_LIMITED':
          setFormError(err.message);
          break;
        case 'VALIDATION_FAILED':
          setFieldErrors(toFieldErrorMap(err.details));
          setFormError(err.details.length ? null : err.message);
          break;
        default:
          setFormError(err.message);
      }
    }
  }

  const emailErr = fieldErrors.email;
  const passwordErr = fieldErrors.password;

  return (
    <div className="admin-login">
      <Seo title="Admin login" noindex />
      <main className="admin-login__card">
        <div className="admin-login__brand">
          <BrandMark width={32} height={32} />
          <span>{BRAND.name} admin</span>
        </div>
        <h1 className="admin-login__title">Log in</h1>
        {state.expired ? (
          <p className="notice notice--info" role="status">
            Your session ended. Log in again to carry on.
          </p>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="form" aria-describedby={formError ? `${id}-error` : undefined}>
          <div className="field">
            <label htmlFor={`${id}-email`}>Email</label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailErr ? true : undefined}
              aria-describedby={emailErr ? `${id}-email-err` : undefined}
              maxLength={254}
            />
            {emailErr ? (
              <p id={`${id}-email-err`} className="field__error">
                {emailErr}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor={`${id}-password`}>Password</label>
            <input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={passwordErr ? true : undefined}
              aria-describedby={passwordErr ? `${id}-password-err` : undefined}
              maxLength={200}
            />
            {passwordErr ? (
              <p id={`${id}-password-err`} className="field__error">
                {passwordErr}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p id={`${id}-error`} className="notice notice--error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="btn btn--admin-primary btn--block" disabled={pending}>
            {pending ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="admin-login__back">
          <Link to="/">Back to the shop</Link>
        </p>
      </main>
    </div>
  );
}
