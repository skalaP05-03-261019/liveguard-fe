<script setup lang="ts">
import { categoryLabels, verdictLabels, type Finding } from './contracts';
defineProps<{ findings: Finding[]; mock?: boolean }>();
</script>

<template>
  <section class="ai-evidence" aria-label="AI 판단 근거">
    <header><b>AI 판단 근거</b><small>{{mock ? '목업 시뮬레이션' : '서버에 저장된 AI 조사 결과'}}</small></header>
    <article v-for="f in findings" :key="f.messageId" class="review-ai" :data-finding-message-id="f.messageId">
      <div><span class="verdict-badge" :class="{violation: f.verdict==='VIOLATION', clear: f.verdict==='NO_VIOLATION', review: f.verdict==='NEEDS_REVIEW'}">{{f.missingFacts.some(fact => /\b(INVALID_MODEL_OUTPUT|INVALID_POLICY_EVIDENCE)\b/.test(fact)) ? '안전 보류' : 'AI 제안'}} · {{verdictLabels[f.verdict]}}</span> <code>{{f.verdict}}</code></div>
      <p class="review-ai-reason">{{f.reason}}</p>
      <dl>
        <div><dt>위반 유형</dt><dd>{{f.categories.map(c => categoryLabels[c] ?? c).join(' · ') || '제안된 유형 없음'}}</dd></div>
        <div><dt>근거 정책</dt><dd>{{f.policyIds.join(', ') || '제출된 정책 근거 없음'}}</dd></div>
        <div v-if="f.missingFacts.length"><dt>추가 확인 필요</dt><dd><ul><li v-for="fact in f.missingFacts" :key="fact">{{fact}}</li></ul></dd></div>
      </dl>
    </article>
    <p v-if="!findings.length" class="section-empty">저장된 AI 판단 근거가 없습니다.</p>
  </section>
</template>

<style scoped>
.ai-evidence { margin: 10px 0; padding: 12px; border: 1px solid #dddfe8; border-radius: 8px; background: #fafaff; }
header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 8px; }
header small { color: #666; }
.review-ai { display: block; overflow-wrap: anywhere; }
.review-ai + .review-ai { border-top: 1px solid #dddfe8; padding-top: 10px; }
.review-ai-reason { display: block; -webkit-line-clamp: unset; overflow: visible; white-space: pre-wrap; line-height: 1.6; }
dl { margin: 8px 0; font-size: 12px; }
dl > div { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 6px; }
dt { color: #666; min-width: 80px; }
dd { flex: 1; min-width: 140px; margin: 0; white-space: pre-wrap; }
ul { margin: 0; padding-left: 16px; }
</style>
