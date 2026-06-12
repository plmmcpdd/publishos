import { useState } from 'react';
import { loginClient } from '../api';

interface LoginScreenProps {
  onLogin: (token: string, client: { id: string; name: string; industry?: string }) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('abc@hvac.com');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await loginClient(email, password);
      localStorage.setItem('token', data.token);
      localStorage.setItem('clientId', data.client.id);
      localStorage.setItem('clientName', data.client.name);
      if (!localStorage.getItem('deviceId')) {
        localStorage.setItem('deviceId', `device-${Math.random().toString(36).slice(2, 11)}`);
      }
      onLogin(data.token, data.client);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-logo">PublishOS</h1>
        <p className="login-subtitle">Sign in to review your content</p>
        {error && <div className="login-error">{error}</div>}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="login-input"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleLogin();
          }}
          className="login-input"
        />
        <button type="button" onClick={() => void handleLogin()} disabled={loading} className="login-button">
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}
