// 引入mitt 
import mitt from "mitt";

// 创建emitter
const emitter = mitt()


// 【第二步】：接收数据的组件中：绑定事件、同时在销毁前解绑事件：

// import emitter from "@/utils/emitter";
// import { onUnmounted } from "vue";

// // 绑定事件
// emitter.on('send-toy',(value)=>{
//   console.log('send-toy事件被触发',value)
// })

// onUnmounted(()=>{
//   // 解绑事件
//   emitter.off('send-toy')
// })

// 【第三步】：提供数据的组件，在合适的时候触发事件

// import emitter from "@/utils/emitter";

// function sendToy(){
//   // 触发事件
//   emitter.emit('send-toy',toy.value)
// }



/*
  // 绑定事件
  emitter.on('abc',(value)=>{
    console.log('abc事件被触发',value)
  })
  emitter.on('xyz',(value)=>{
    console.log('xyz事件被触发',value)
  })

  setInterval(() => {
    // 触发事件
    emitter.emit('abc',666)
    emitter.emit('xyz',777)
  }, 1000);

  setTimeout(() => {
    // 清理事件
    emitter.all.clear()
  }, 3000); 
*/

// 创建并暴露mitt
export default emitter