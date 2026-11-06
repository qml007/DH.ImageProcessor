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
        }
      ]
    }
  ]
})

export default router
