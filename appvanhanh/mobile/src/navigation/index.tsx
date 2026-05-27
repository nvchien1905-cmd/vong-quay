import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { Colors } from '../utils/colors';

import LoginScreen from '../screens/auth/LoginScreen';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import TaskListScreen from '../screens/tasks/TaskListScreen';
import TaskDetailScreen from '../screens/tasks/TaskDetailScreen';
import TaskCreateScreen from '../screens/tasks/TaskCreateScreen';
import ChecklistScreen from '../screens/checklist/ChecklistScreen';
import ChecklistSessionScreen from '../screens/checklist/ChecklistSessionScreen';
import KpiScreen from '../screens/kpi/KpiScreen';
import ReportScreen from '../screens/reports/ReportScreen';
import SopListScreen from '../screens/sop/SopListScreen';
import SopDetailScreen from '../screens/sop/SopDetailScreen';
import QuizScreen from '../screens/sop/QuizScreen';
import ProfileScreen from '../screens/auth/ProfileScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const commonHeaderStyle = {
  headerStyle: { backgroundColor: Colors.primary },
  headerTintColor: Colors.white,
  headerTitleStyle: { fontWeight: '700' as const },
};

function TaskStack() {
  return (
    <Stack.Navigator screenOptions={commonHeaderStyle}>
      <Stack.Screen name="TaskList" component={TaskListScreen} options={{ title: 'Công việc' }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Chi tiết task' }} />
      <Stack.Screen name="TaskCreate" component={TaskCreateScreen} options={{ title: 'Tạo task mới' }} />
    </Stack.Navigator>
  );
}

function ChecklistStack() {
  return (
    <Stack.Navigator screenOptions={commonHeaderStyle}>
      <Stack.Screen name="ChecklistList" component={ChecklistScreen} options={{ title: 'Checklist ca' }} />
      <Stack.Screen name="ChecklistSession" component={ChecklistSessionScreen} options={{ title: 'Thực hiện checklist' }} />
    </Stack.Navigator>
  );
}

function SopStack() {
  return (
    <Stack.Navigator screenOptions={commonHeaderStyle}>
      <Stack.Screen name="SopList" component={SopListScreen} options={{ title: 'Tài liệu & SOP' }} />
      <Stack.Screen name="SopDetail" component={SopDetailScreen} options={{ title: 'Xem tài liệu' }} />
      <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: 'Kiểm tra' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const icons: Record<string, string> = {
            Dashboard: focused ? 'home' : 'home-outline',
            Tasks: focused ? 'checkmark-circle' : 'checkmark-circle-outline',
            Checklist: focused ? 'list' : 'list-outline',
            KPI: focused ? 'stats-chart' : 'stats-chart-outline',
            SOP: focused ? 'book' : 'book-outline',
          };
          return <Ionicons name={icons[route.name] as any} size={size} color={color} />;
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: { backgroundColor: Colors.white, borderTopColor: Colors.border },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen}
        options={{ title: 'Tổng quan', headerShown: true, ...commonHeaderStyle }} />
      <Tab.Screen name="Tasks" component={TaskStack} options={{ title: 'Công việc' }} />
      <Tab.Screen name="Checklist" component={ChecklistStack} options={{ title: 'Checklist' }} />
      <Tab.Screen name="KPI" component={KpiScreen}
        options={{ title: 'KPI', headerShown: true, ...commonHeaderStyle }} />
      <Tab.Screen name="SOP" component={SopStack} options={{ title: 'Đào tạo' }} />
    </Tab.Navigator>
  );
}

export default function Navigation() {
  const { isAuthenticated } = useAuthStore();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Profile" component={ProfileScreen}
              options={{ headerShown: true, title: 'Tài khoản', ...commonHeaderStyle }} />
            <Stack.Screen name="Reports" component={ReportScreen}
              options={{ headerShown: true, title: 'Báo cáo', ...commonHeaderStyle }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
