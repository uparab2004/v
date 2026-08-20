import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { Tabs } from 'expo-router';
import { ShoppingCart, Users } from 'lucide-react-native';
import { useHousehold } from '@/contexts/HouseholdContext';
import { colors, fontFamily, spacing } from '@/lib/theme';

export default function TabLayout() {
  const { phase } = useHousehold();

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.neutral[50] }}>
        <ActivityIndicator size="large" color={colors.primary[600]} />
      </View>
    );
  }

  if (phase === 'onboarding') return <Redirect href="/(auth)" />;
  if (phase === 'pending' || phase === 'rejected') return <Redirect href="/(auth)/pending" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.neutral[400],
        tabBarLabelStyle: {
          fontFamily: fontFamily.medium,
          fontSize: 13,
        },
        tabBarStyle: {
          backgroundColor: colors.neutral[0],
          borderTopColor: colors.neutral[200],
          borderTopWidth: 1,
          paddingBottom: spacing(1),
          paddingTop: spacing(1),
          height: 60,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'القائمة',
          tabBarIcon: ({ size, color }) => <ShoppingCart size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: 'الأعضاء',
          tabBarIcon: ({ size, color }) => <Users size={size} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
