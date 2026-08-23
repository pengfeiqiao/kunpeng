import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  elements: string[];
  challenge: boolean;
  ready_state: string;
}

export function formatBrowserSnapshot(snapshot: BrowserSnapshot): string {
  const lines = [
    `页面：${snapshot.title || '未命名页面'}`,
    `地址：${snapshot.url}`,
    `状态：${snapshot.ready_state}${snapshot.challenge ? ' · 需要人工验证或登录' : ''}`,
  ];
  if (snapshot.text.trim()) lines.push(`\n正文：\n${snapshot.text.trim()}`);
  if (snapshot.elements.length) lines.push(`\n可操作元素：\n${snapshot.elements.join('\n')}`);
  if (snapshot.challenge) {
    lines.push('\n[需要人工处理] 请调用 browser_control(action="show") 打开可见浏览器，让用户完成登录或验证码；完成后调用 snapshot 继续。不要反复刷新或尝试绕过验证。');
  }
  return lines.join('\n');
}

async function snapshot(maxChars?: number): Promise<BrowserSnapshot> {
  return invoke<BrowserSnapshot>('browser_snapshot', { maxChars });
}

/** 没有可用浏览器内核时的引导：让 Agent 能自愈。 */
const MISSING_BROWSER_RE = /找不到可用的 Chromium|Chromium|浏览器内核/i;

export const browserInstallTool: Tool = {
  definition: {
    name: 'browser_install',
    description:
      '下载并安装鲲鹏的浏览器内核（约 170MB，一次性）。当 browser_control/web_fetch 报「找不到可用的 Chromium」时调用；完成后重试原操作。',
    parameters: { type: 'object', properties: {} },
  },
  risk: 'safe',
  async execute() {
    try {
      const path = await invoke<string>('browser_install');
      return { success: true, output: `浏览器内核已就绪：${path}\n请重试刚才的浏览器操作。` };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const browserControlTool: Tool = {
  definition: {
    name: 'browser_control',
    description:
      '操控鲲鹏的持久化 Chromium 浏览器，支持动态网页、登录态页面和可视化交互。' +
      '操作元素必须使用 snapshot 返回的 [e1] 引用；页面变化后先重新 snapshot。' +
      '遇到验证码/登录时用 show 打开窗口交给用户处理，不得绕过验证。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'snapshot', 'show', 'click', 'type', 'press_enter', 'scroll_down', 'scroll_up', 'back', 'forward', 'reload', 'wait', 'screenshot', 'close'],
          description: '浏览器操作。open 默认后台打开；show 打开可见窗口；screenshot 保存当前页面截图。',
        },
        url: { type: 'string', description: 'open 时必填的 http/https 地址' },
        ref: { type: 'string', description: 'click/type/press_enter 使用的元素引用，如 e3' },
        value: { type: 'string', description: 'type 时输入的文本' },
        visible: { type: 'boolean', description: 'open 时是否显示浏览器窗口，默认 false' },
        maxChars: { type: 'number', description: '页面正文最多返回字符数，默认 30000，上限 200000' },
      },
      required: ['action'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const args = params as {
      action?: string;
      url?: string;
      ref?: string;
      value?: string;
      visible?: boolean;
      maxChars?: number;
    };
    const action = args.action || '';
    try {
      if (action === 'open') {
        if (!args.url || !/^https?:\/\//i.test(args.url)) {
          return { success: false, output: '', error: 'open 需要完整的 http/https URL' };
        }
        const result = await invoke<BrowserSnapshot>('browser_open', {
          url: args.url,
          visible: args.visible ?? false,
          maxChars: args.maxChars,
        });
        return { success: true, output: formatBrowserSnapshot(result) };
      }
      if (action === 'snapshot') {
        return { success: true, output: formatBrowserSnapshot(await snapshot(args.maxChars)) };
      }
      if (action === 'show') {
        const current = await snapshot(args.maxChars);
        const result = await invoke<BrowserSnapshot>('browser_open', {
          url: current.url,
          visible: true,
          maxChars: args.maxChars,
        });
        return {
          success: true,
          output: `${formatBrowserSnapshot(result)}\n\n浏览器窗口已打开。请等待用户完成登录或验证后，再调用 snapshot。`,
        };
      }
      if (action === 'screenshot') {
        const path = await invoke<string>('browser_screenshot');
        return { success: true, output: `当前网页截图已保存：${path}\n需要理解视觉布局时，请继续调用 vision 工具分析该图片。` };
      }
      if (action === 'close') {
        await invoke('browser_close');
        return { success: true, output: '浏览器会话已关闭；登录 Cookie 仍保存在鲲鹏专用浏览器资料中。' };
      }
      if (['click', 'type', 'press_enter'].includes(action) && !args.ref) {
        return { success: false, output: '', error: `${action} 需要 snapshot 返回的 ref` };
      }
      const result = await invoke<BrowserSnapshot>('browser_action', {
        action,
        reference: args.ref,
        value: args.value,
        maxChars: args.maxChars,
      });
      return { success: true, output: formatBrowserSnapshot(result) };
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (MISSING_BROWSER_RE.test(message)) {
        message += '\n\n[可自愈] 调用 browser_install 自动下载浏览器内核（约 170MB，一次性），完成后重试当前操作；或请用户安装 Google Chrome。';
      }
      return {
        success: false,
        output: '',
        error: message,
      };
    }
  },
};
