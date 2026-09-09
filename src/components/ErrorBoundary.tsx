/**
 * src/components/ErrorBoundary.tsx —— 渲染期异常防火墙。
 *
 * 用途：单个单元格/组件在渲染或事件处理中抛错时，React 18 默认会卸载整棵组件树，
 * 导致白屏且内存态 store 看似"全部丢失"（实际数据仍在 zustand，只是界面崩了）。
 * 这里把错误隔离在边界内：显示可读的错误信息 + 「重试」按钮，数据（plan/store）不丢。
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  stack?: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 仅记录，不改写任何业务状态；store 中的数据保持不变。
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] 捕获到渲染期异常：', error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, message: '' });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          margin: 16,
          padding: 20,
          border: '1px solid var(--error)',
          borderRadius: 8,
          background: 'var(--error-soft)',
          color: 'var(--error)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
          {t('errorBoundary.title')}
        </div>
        <div style={{ marginBottom: 8, opacity: 0.85 }}>{this.state.message}</div>
        <button
          type="button"
          onClick={this.handleRetry}
          style={{
            padding: '6px 14px',
            border: '1px solid var(--error)',
            borderRadius: 6,
            background: 'var(--surface)',
            color: 'var(--error)',
            cursor: 'pointer',
          }}
        >
          {t('errorBoundary.retry')}
        </button>
        <div style={{ marginTop: 10, opacity: 0.6, fontSize: 12 }}>
          {t('errorBoundary.desc')}
        </div>
      </div>
    );
  }
}
