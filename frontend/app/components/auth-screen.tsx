"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { ArrowRight, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { ApiUser, chatWaveApi } from "../api";

type AuthMode = "login" | "signup";

export function AuthScreen({
  checking = false,
  onAuthenticated,
}: {
  checking?: boolean;
  onAuthenticated: (user: ApiUser) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [nickname, setNickname] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (
      mode === "signup" &&
      (!/[a-z]/.test(password) ||
        !/[A-Z]/.test(password) ||
        !/[0-9]/.test(password))
    ) {
      setError("Пароль должен содержать строчную и заглавную буквы и цифру.");
      return;
    }

    setLoading(true);
    try {
      const user =
        mode === "signup"
          ? await chatWaveApi.signup(nickname.trim(), username.trim(), password)
          : await chatWaveApi.login(username.trim(), password);
      onAuthenticated(user);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : mode === "signup"
            ? "Не удалось создать аккаунт"
            : "Не удалось войти",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-aurora auth-aurora-one" />
      <div className="auth-aurora auth-aurora-two" />
      <section className="auth-promo">
        <div className="auth-logo">
          <Image src="/chatwave-logo.svg" alt="ChatWave" width={52} height={52} />
          <strong>ChatWave</strong>
        </div>
        <div className="auth-promo-copy">
          <span className="eyebrow">Signal Focus · Aurora Glass</span>
          <h1>Общение, которое принадлежит вам.</h1>
          <p>
            Личные диалоги, группы, файлы и звонки на вашем собственном
            защищённом сервере.
          </p>
        </div>
        <div className="auth-trust">
          <span>
            <ShieldCheck size={17} /> HTTPS и защищённые сессии
          </span>
          <span>
            <LockKeyhole size={17} /> Токен хранится только во вкладке
          </span>
        </div>
      </section>

      <section className="auth-panel" aria-live="polite">
        {checking ? (
          <div className="auth-checking">
            <span className="auth-spinner" />
            <h2>Восстанавливаем сессию</h2>
            <p>Безопасно проверяем подключение к вашему серверу.</p>
          </div>
        ) : (
          <>
            <div className="auth-tabs" role="tablist" aria-label="Авторизация">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "active" : ""}
                onClick={() => switchMode("login")}
              >
                Вход
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                className={mode === "signup" ? "active" : ""}
                onClick={() => switchMode("signup")}
              >
                Регистрация
              </button>
            </div>

            <div className="auth-heading">
              <span className="auth-heading-icon">
                {mode === "login" ? (
                  <LockKeyhole size={21} />
                ) : (
                  <UserPlus size={21} />
                )}
              </span>
              <div>
                <h2>{mode === "login" ? "С возвращением" : "Создать аккаунт"}</h2>
                <p>
                  {mode === "login"
                    ? "Войдите, чтобы открыть ваши чаты."
                    : "Пара минут — и можно начинать общение."}
                </p>
              </div>
            </div>

            <form className="auth-form" onSubmit={submit}>
              {mode === "signup" && (
                <label>
                  Отображаемое имя
                  <input
                    autoFocus
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="Никита"
                    minLength={3}
                    maxLength={128}
                    autoComplete="name"
                    required
                  />
                </label>
              )}
              <label>
                Логин
                <input
                  autoFocus={mode === "login"}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="username"
                  minLength={3}
                  maxLength={64}
                  autoCapitalize="none"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Пароль
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Минимум 8 символов"
                  minLength={8}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                />
              </label>
              {mode === "signup" && (
                <p className="password-hint">
                  Заглавная и строчная буквы, минимум одна цифра.
                </p>
              )}
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}
              <button className="auth-submit" disabled={loading}>
                {loading ? <span className="button-spinner" /> : <ArrowRight size={18} />}
                {loading
                  ? mode === "login"
                    ? "Входим…"
                    : "Создаём…"
                  : mode === "login"
                    ? "Войти"
                    : "Создать аккаунт"}
              </button>
            </form>

            <div className="auth-server-status">
              <span />
              Сервер ChatWave подключён и готов
            </div>
          </>
        )}
      </section>
    </main>
  );
}
