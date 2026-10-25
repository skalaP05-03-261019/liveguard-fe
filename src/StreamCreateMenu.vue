<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref} from 'vue';
import {Video,Radio} from 'lucide-vue-next';
const props=defineProps<{disabled:boolean;reason?:string}>();
const emit=defineEmits<{start:[]}>();
const expanded=ref(false),root=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null),item=ref<HTMLButtonElement|null>(null);
async function toggle(){expanded.value=!expanded.value;if(expanded.value){await nextTick();item.value?.focus();}}
function close(restore=false){expanded.value=false;if(restore)trigger.value?.focus();}
function outside(e:PointerEvent){if(e.target instanceof Node&&!root.value?.contains(e.target))close();}
function start(){if(props.disabled)return;close(true);emit('start');}
function key(e:KeyboardEvent){if(!expanded.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();item.value?.focus();}else if(e.key==='Tab')close();}
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);});
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);});
</script>
<template>
 <div ref="root" class="stream-create">
  <button ref="trigger" type="button" class="stream-create-trigger" aria-haspopup="menu" :aria-expanded="expanded" aria-controls="stream-create-menu" @click="toggle"><Video :size="22"/><span>만들기</span></button>
  <div v-if="expanded" id="stream-create-menu" class="stream-create-menu" role="menu" aria-label="만들기">
   <button ref="item" type="button" role="menuitem" :aria-disabled="disabled" :aria-describedby="disabled&&reason?'stream-create-reason':undefined" @click="start"><Radio :size="22"/><span>라이브 스트리밍 시작</span></button>
   <p v-if="disabled&&reason" id="stream-create-reason">{{reason}}</p>
  </div>
 </div>
</template>
