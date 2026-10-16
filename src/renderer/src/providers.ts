import type { ProviderId } from '../../preload/api'

/** 設定と初回の案内で出す、AI ごとのキーの作り方とデータの扱い */
export const PROVIDER_NOTES: Record<ProviderId, string> = {
  sarashina:
    '日本語に強い国産の AI です。キーは Sarashina の開発者向けページで作れます。無料ベータでは、送った内容が AI の学習に使われます。',
  gemini:
    'キーは Google AI Studio で作れます。無料枠では、送った内容が Google のサービス改善に使われることがあります。支払い方法を登録した有料枠では使われません。',
  claude:
    'キーは Claude の開発者向けページ（Claude Console）で作れます。使った分だけ料金がかかります。送った内容は、初期設定では AI の学習に使われません。'
}

export const PROVIDER_OPTIONS: [ProviderId, string][] = [
  ['sarashina', 'Sarashina（SB Intuitions）'],
  ['gemini', 'Gemini（Google）'],
  ['claude', 'Claude（Anthropic）']
]
