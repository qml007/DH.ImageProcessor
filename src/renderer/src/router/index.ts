import { createRouter, createWebHashHistory } from 'vue-router'
import AdminLayout from '../layouts/AdminLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: AdminLayout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'dashboard',
          component: () => import('../views/DashboardView.vue'),
          meta: { title: '工作台' }
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('../views/UsersView.vue'),
          meta: { title: '用户管理' }
        },
        {
          path: 'images',
          name: 'images',
          component: () => import('../views/ImportImagesView.vue'),
          meta: { title: '图像处理' }
        },
        {
          path: 'images/edit/:id',
          name: 'image-edit',
          component: () => import('../views/ImageEditView.vue'),
          meta: { title: '图像编辑' }
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('../views/SettingsView.vue'),
          meta: { title: '系统设置' }
        },
        {
          path: 'archives-types',
          name: 'archives-types',
          component: () => import('../views/ArchivesTypeView.vue'),
          meta: { title: '档案类型' }
        },
        {
          path: 'ai-services',
          name: 'ai-services',
          component: () => import('../views/AIServiceView.vue'),
          meta: { title: 'AI服务' }
        },
        {
          path: 'archives-types/:typeId/fields',
          name: 'archives-type-fields',
          component: () => import('../views/ArchivesFieldsView.vue'),
          meta: { title: '档案字段定义' }
        },
        {
          path: 'batches',
          name: 'batches',
          component: () => import('../views/BatInfoView.vue'),
          meta: { title: '批次管理' }
        },
        {
          path: 'ai-chat',
          name: 'ai-chat',
          component: () => import('../views/AIChatView.vue'),
          meta: { title: 'AI对话' }
        },
        {
          path: 'batches/:batId/fields',
          name: 'batch-fields',
          component: () => import('../views/BatFieldsView.vue'),
          meta: { title: '批次字段' }
        }
      ]
    }
  ]
})

export default router
