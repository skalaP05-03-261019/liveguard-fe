<script setup lang="ts">
import {nextTick,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {LogOut} from 'lucide-vue-next';
import {avatarColor} from './avatar';
const props=withDefaults(defineProps<{nickname:string;accountLabel?:string}>(),{accountLabel:'스트리머 계정'});
const emit=defineEmits<{logout:[]}>();
const expanded=ref(false),root=ref<HTMLElement|null>(null),trigger=ref<HTMLButtonElement|null>(null),logout=ref<HTMLButtonElement|null>(null);
async function toggle(){expanded.value=!expanded.value;if(expanded.value){await nextTick();logout.value?.focus();}}
function close(restore=false){expanded.value=false;if(restore)trigger.value?.focus();}
function outside(e:PointerEvent){if(e.target instanceof Node&&!root.value?.contains(e.target))close();}
function key(e:KeyboardEvent){if(!expanded.value)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();logout.value?.focus();}else if(e.key==='Tab')close();}
watch(()=>props.nickname,()=>close());
onMounted(()=>{document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);});
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);});
</script>
<template>
 <div ref="root" class="account-menu">
  <button ref="trigger" type="button" class="account-menu-trigger yt-icon-button" aria-label="계정 메뉴" title="계정 메뉴" aria-haspopup="menu" aria-controls="account-dropdown-menu" :aria-expanded="expanded" @click="toggle"><span class="yt-me" :style="{background:avatarColor(nickname)}" aria-hidden="true">{{nickname.slice(0,1)}}</span></button>
  <div v-if="expanded" id="account-dropdown-menu" class="account-menu-panel" role="menu" aria-label="계정">
   <div class="account-menu-summary"><span class="yt-me" :style="{background:avatarColor(nickname)}" aria-hidden="true">{{nickname.slice(0,1)}}</span><div><b>{{nickname}}</b><small>{{accountLabel}}</small></div></div>
   <button ref="logout" type="button" role="menuitem" @click="close();emit('logout')"><LogOut :size="20"/><span>로그아웃</span></button>
  </div>
 </div>
</template>
