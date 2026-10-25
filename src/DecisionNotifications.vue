<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {Bell,ClipboardCheck,UserX,X,Settings} from 'lucide-vue-next';
import type {LiveReview} from './contracts';
import {dateTimeText} from './chatTime';
const props=defineProps<{reviews:LiveReview[];liveId:string;ended:boolean}>();
const iso=(value:string|number)=>typeof value==='number'?new Date(value).toISOString():value;
const emit=defineEmits<{open:[review:LiveReview];settings:[];activity:[]}>();
const expanded=ref(false),root=ref<HTMLElement|null>(null),bell=ref<HTMLButtonElement|null>(null),closeButton=ref<HTMLButtonElement|null>(null);
async function toggle(){expanded.value=!expanded.value;if(expanded.value){await nextTick();closeButton.value?.focus();}}
function close(restore=false){expanded.value=false;if(restore)bell.value?.focus();}
function outside(e:PointerEvent){if(e.target instanceof Node&&!root.value?.contains(e.target))close();}
function key(e:KeyboardEvent){if(e.key==='Escape'&&expanded.value){e.preventDefault();e.stopPropagation();close(true);}}
function open(review:LiveReview){
 if(props.ended||review.liveId!==props.liveId||!props.reviews.some(r=>r.reviewId===review.reviewId&&r.status==='PENDING'))return;
 close();emit('open',review);
}
watch(()=>[props.liveId,props.ended],()=>close());
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);});
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);});
</script>
<template>
 <div ref="root" class="decision-notifications">
  <button ref="bell" type="button" class="decision-bell" :class="{selected:expanded}" :aria-label="`알림 · 결정 대기 ${reviews.length}건`" :aria-expanded="expanded" aria-controls="decision-notification-panel" @click="toggle">
   <Bell :size="26" :stroke-width="1.7" aria-hidden="true"/>
   <span v-if="reviews.length" class="decision-bell-count" aria-hidden="true">{{reviews.length>9?'9+':reviews.length}}</span>
  </button>
  <section v-if="expanded" id="decision-notification-panel" class="decision-notification-panel" role="dialog" aria-label="알림">
   <header><h2>알림</h2><div class="decision-notification-actions"><button type="button" aria-label="알림 설정" @click="close();emit('settings')"><Settings :size="24"/></button><button ref="closeButton" type="button" aria-label="알림 닫기" @click="close(true)"><X :size="23"/></button></div></header>
   <div class="decision-notification-body">
    <h3>결정 대기 <span>{{reviews.length}}건</span></h3>
    <p v-if="ended||!reviews.length" class="decision-notification-empty">{{ended?'방송이 종료되었습니다.':'결정을 기다리는 요청이 없습니다.'}}</p>
    <ul v-else>
     <li v-for="review in reviews" :key="review.reviewId">
      <button type="button" class="decision-notification-item" @click="open(review)">
       <span class="decision-notification-dot" aria-hidden="true"/>
       <span class="decision-notification-avatar" :class="review.kind.toLowerCase()"><UserX v-if="review.kind==='KICK'" :size="23"/><ClipboardCheck v-else :size="23"/></span>
       <span class="decision-notification-copy"><b>{{review.kind==='KICK'?'강퇴 승인 요청':'문맥 검토 요청'}}</b><span>{{review.kind==='KICK'?'기준 사건과 처리 내용을 확인하고 승인 여부를 결정하세요.':review.findings.length?'AI 판단 근거와 채팅 문맥을 확인해 주세요.':'AI 결과 없이 열린 검토입니다. 채팅 문맥을 확인해 주세요.'}}</span><small>요청 {{review.reviewId.slice(0,8)}}</small><time :datetime="iso(review.createdAt)">{{dateTimeText(iso(review.createdAt))}}</time></span>
      </button>
     </li>
    </ul>
   </div>
   <footer>항목을 선택하면 해당 요청의 상세 내용이 열립니다.<button type="button" class="notification-activity-link" @click="close();emit('activity')">처리 알림 보기</button></footer>
  </section>
 </div>
</template>
