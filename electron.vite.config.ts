import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        // OCR 模型由主进程按运行环境显式指定，避免打包后解析 import.meta.url 失败
        '@gutenye/ocr-models/node': resolve('src/main/ocr/emptyModels.ts')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          ocrWorker: resolve('src/main/ocr/worker.ts')
        },
        // 原生模块保持外部引用，打包时通过 asarUnpack 提供
        external: ['better-sqlite3', 'onnxruntime-node', 'sharp']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
