<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref} from 'vue';
import {Radio} from 'lucide-vue-next';
const props=defineProps<{live:boolean;disabled:boolean;reason?:string}>();
const emit=defineEmits<{start:[];end:[]}>();
const expanded=ref(false),root=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null),item=ref<HTMLButtonElement|null>(null);
let returnTrigger:HTMLButtonElement|null=null;
async function toggle(event?:Event){returnTrigger=event?.currentTarget as HTMLButtonElement|null;expanded.value=!expanded.value;if(expanded.value){await nextTick();item.value?.focus();}}
function close(restore=false){expanded.value=false;if(restore)(returnTrigger??trigger.value)?.focus();}
function outside(e:PointerEvent){if(e.target instanceof Node&&!root.value?.contains(e.target))close();}
function start(){if(props.disabled)return;close(true);if(props.live)emit('end');else emit('start');}
function key(e:KeyboardEvent){if(!expanded.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();item.value?.focus();}else if(e.key==='Tab')close();}
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);});
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);});
</script>
<template>
 <div ref="root" class="stream-create">
  <button ref="trigger" type="button" class="yt-icon-button broadcast-status" :class="{live}" :data-live="live" :aria-label="live ? '방송 중 · 방송 관리' : '방송 대기 · 방송 관리'" :title="live ? '방송 중' : '방송 대기'" aria-haspopup="menu" :aria-expanded="expanded" aria-controls="stream-create-menu" @click="toggle"><Radio :size="24"/></button>
  <div v-if="expanded" id="stream-create-menu" class="stream-create-menu" role="menu" aria-label="방송 관리">
   <button ref="item" type="button" role="menuitem" :aria-disabled="disabled" :aria-describedby="disabled&&reason?'stream-create-reason':undefined" @click="start"><Radio :size="22"/><span>{{live?'방송 종료':'라이브 스트리밍 시작'}}</span></button>
   <p v-if="disabled&&reason" id="stream-create-reason">{{reason}}</p>
  </div>
 </div>
</template>
