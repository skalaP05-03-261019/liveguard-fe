<script setup lang="ts">
import {AlertTriangle, Circle, ClipboardCheck, UserX} from 'lucide-vue-next';
defineProps<{title:string;kind:'KICK'|'CONTEXT';count:number;description:string;emptyText:string;fresh?:boolean;ended?:boolean}>();
</script>
<template>
 <section class="hitl-section decision-queue status-summary-widget" :class="[kind.toLowerCase(),{'has-pending':count>0}]" :aria-label="title">
  <header class="section-head status-summary-head">
   <div class="status-summary-title"><span class="section-icon status-summary-icon" aria-hidden="true"><UserX v-if="kind==='KICK'" :size="18"/><ClipboardCheck v-else :size="18"/></span><h2>{{title}}</h2></div>
   <span class="pending-count status-summary-count" :class="{'is-pending':count>0}">{{count}}건</span>
   <span v-if="fresh" class="queue-new-indicator">새 요청</span>
  </header>
  <p class="queue-note status-summary-description">{{description}}</p>
  <p v-if="!count" class="section-empty status-summary-empty"><Circle :size="16" aria-hidden="true"/><span>{{emptyText}}</span></p>
  <p v-else class="status-summary-action"><AlertTriangle :size="16" aria-hidden="true"/><span>{{ended?'방송이 종료되어 결정할 수 없습니다.':'처리 대기 중인 항목이 있습니다.'}}</span></p>
  <slot/>
 </section>
</template>
