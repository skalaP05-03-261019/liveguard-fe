<script setup lang="ts">
// 시청자 관리 탭(#5). 제재받은 시청자의 상태를 요약하고, 사건 흐름·결정 대기로 연결한다.
// 이 화면의 직접 조치는 시청자 근거의 오판 취소(findings/revoke)만 둔다.
import { computed, reactive, ref } from 'vue';
import { ChevronDown, ChevronRight, Users } from 'lucide-vue-next';
import { dateTimeText } from './chatTime';
import {
  caseStatusLabels, categoriesOf, categoryName, confirmedCount, lastAt, latestViolationCount, statusOf, statusOrder, viewerStatusLabels,
  type ViewerCase, type ViewerFinding, type ViewerRow, type ViewerStatus
} from './viewerManage';

const props = defineProps<{ rows: ViewerRow[]; busy?: boolean; scope: string }>();
const emit = defineEmits<{
  revoke: [item: ViewerCase, finding: ViewerFinding, reason: string];
  openCase: [caseId: string];
  openReview: [reviewId: string];
}>();

const filter = ref<'ALL' | ViewerStatus>('ALL');
const open = ref<string | null>(null);
const revoking = ref<string | null>(null);
// 판단 근거·취소 사유. 키는 reviewId 또는 findingId.
const reasons = reactive<Record<string, string>>({});
const counts = computed(() => {
  const out = Object.fromEntries(statusOrder.map(s => [s, 0])) as Record<ViewerStatus, number>;
  for (const row of props.rows) out[statusOf(row)]++;
  return out;
});
const chips = computed(() => statusOrder.filter(s => counts.value[s] > 0));
// 사람이 결정해야 하는 검토(강퇴 승인·문맥 검토)가 남은 시청자 수
const needDecision = computed(() => props.rows.filter(row => row.reviews.some(r => r.status === 'PENDING')).length);
const shown = computed(() => filter.value === 'ALL' ? props.rows : props.rows.filter(row => statusOf(row) === filter.value));
const pendingOf = (row: ViewerRow) => row.reviews.filter(r => r.status === 'PENDING');
const asTime = (v: string) => dateTimeText(v || null);
const reasonOf = (id: string) => (reasons[id] ?? '').trim();
function toggle(name: string) { open.value = open.value === name ? null : name; revoking.value = null; }
// 오판 취소 사유는 Backend 계약대로 필수다.
function revoke(item: ViewerCase, finding: ViewerFinding) { if (reasonOf(finding.findingId)) { emit('revoke', item, finding, reasonOf(finding.findingId)); revoking.value = null; } }
</script>

<template>
  <section class="vm card" aria-label="시청자 관리">
    <header class="vm-head">
      <div><h2><Users :size="22"/> 시청자 관리</h2><p>{{scope}} 기준으로 제재를 받은 시청자의 상태를 봅니다. 사건 흐름과 검토 결정은 해당 화면에서 확인할 수 있습니다.</p></div>
      <span class="vm-head-end"><b v-if="needDecision" class="vm-need" role="status">사람 결정 필요 {{needDecision}}명</b><span class="vm-total">{{rows.length}}명</span></span>
    </header>
    <div class="vm-chips" role="group" aria-label="상태 필터">
      <button :class="{on: filter==='ALL'}" :aria-pressed="filter==='ALL'" @click="filter='ALL'">전체 <b>{{rows.length}}</b></button>
      <button v-for="s in chips" :key="s" :class="[{on: filter===s}, s.toLowerCase()]" :aria-pressed="filter===s" @click="filter=s">{{viewerStatusLabels[s]}} <b>{{counts[s]}}</b></button>
    </div>
    <div v-if="!rows.length" class="empty-block">아직 제재를 받은 시청자가 없습니다.</div>
    <div v-else class="table-scroll">
      <table class="data-table vm-table">
        <thead><tr><th class="vm-toggle-col"></th><th>시청자</th><th>상태</th><th>확정 위반</th><th>유형</th><th>최근 위반</th><th title="이번 방송에서 이 시청자의 다른 확정 위반 사건 수(현재 사건 제외, 조회 시점 기준). 강퇴 집계(최근 24시간)와 다릅니다.">다른 확정 사건</th></tr></thead>
        <tbody>
          <template v-for="row in shown" :key="row.name">
            <tr class="vm-row" :class="{open: open===row.name}" @click="toggle(row.name)">
              <td class="vm-toggle-col"><button class="vm-expand" :aria-expanded="open===row.name" :aria-label="`${row.name} 상세 ${open===row.name ? '닫기' : '열기'}`" @click.stop="toggle(row.name)"><ChevronDown v-if="open===row.name" :size="18"/><ChevronRight v-else :size="18"/></button></td>
              <td><b>{{row.name}}</b></td>
              <td><span class="vm-badge" :class="statusOf(row).toLowerCase()">{{viewerStatusLabels[statusOf(row)]}}</span></td>
              <td class="vm-num">{{confirmedCount(row)}}</td>
              <td><span v-for="c in categoriesOf(row)" :key="c" class="vm-cat">{{categoryName(c)}}</span><span v-if="!categoriesOf(row).length" class="vm-muted">-</span></td>
              <td>{{asTime(lastAt(row))}}</td>
              <td class="vm-num">{{latestViolationCount(row) ?? '-'}}</td>
            </tr>
            <tr v-if="open===row.name" class="vm-detail">
              <td colspan="7">
                <ol class="vm-cases">
                  <li v-for="c in row.cases" :key="c.caseId">
                    <div class="vm-case-head"><time>{{asTime(c.createdAt)}}</time><span class="vm-case-status" :class="c.confirmationStatus.toLowerCase()">{{caseStatusLabels[c.confirmationStatus] ?? c.confirmationStatus}}</span><span class="vm-muted">사건 …{{c.caseId.slice(-8)}}</span></div>
                    <button type="button" class="vm-link" @click="emit('openCase', c.caseId)">사건 처리 흐름 보기 →</button>
                    <div v-for="f in c.findings" :key="f.findingId" class="vm-finding">
                      <span class="vm-cat">{{categoryName(f.category)}}</span>
                      <span :class="{'vm-muted': f.status!=='CONFIRMED'}">{{f.status==='CONFIRMED' ? '확정' : '오판 취소됨'}}</span>
                      <template v-if="f.status==='CONFIRMED'">
                        <button v-if="revoking!==f.findingId" class="vm-link" :disabled="busy" @click="revoking=f.findingId">오판 취소</button>
                        <span v-else class="vm-inline"><input v-model="reasons[f.findingId]" maxlength="500" placeholder="오판 취소 사유 (필수)" :aria-label="`${categoryName(f.category)} 오판 취소 사유`"/><button class="vm-btn" :disabled="busy || !reasonOf(f.findingId)" @click="revoke(c, f)">취소 확정</button><button class="vm-link" @click="revoking=null">닫기</button></span>
                      </template>
                    </div>
                    <p v-if="!c.findings.length" class="vm-muted">확정된 위반 근거가 없습니다.</p>
                  </li>
                </ol>
                <div v-for="r in pendingOf(row)" :key="r.reviewId" class="vm-review">
                  <div class="vm-review-head"><b>{{r.kind==='KICK' ? '강퇴 승인 대기' : '문맥 검토 대기'}}</b><span class="vm-muted">{{asTime(r.createdAt)}} · {{r.summary}}</span></div>
                  <button type="button" class="vm-link" :disabled="busy" @click="emit('openReview', r.reviewId)">실시간 모니터링에서 결정 →</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p class="vm-foot">API 명세에 없어 보여 주지 않는 것: 시청자 전체 목록 · 이전 방송 이력 · 10분 제한 남은 시간 · 수동 제재·해제</p>
  </section>
</template>
