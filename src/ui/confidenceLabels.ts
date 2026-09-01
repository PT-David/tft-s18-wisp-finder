import type { Confidence } from '../domain/types';

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  official: '官方确认',
  client_data: '客户端数据',
  verified_third_party: '第三方核验',
  community_high_confidence: '高置信观察',
  unverified: '未确认',
};
