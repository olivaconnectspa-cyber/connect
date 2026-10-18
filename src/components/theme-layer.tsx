import { cloneElement, Fragment, isValidElement, useMemo, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppPreferences } from '@/lib/app-preferences';

const darkColors: Record<string, string> = {
  '#F2F5EF': '#111A15',
  '#FFFFFF': '#1C2921',
  '#FFF': '#1C2921',
  '#20352B': '#E7EFE9',
  '#718078': '#A8B8AD',
  '#E5EAE3': '#34453A',
  '#EAF1E8': '#2A4534',
  '#E7EDE3': '#24352A',
  '#DFE8DC': '#2A4534',
  '#D3DDD0': '#45594A',
  '#F7FAF5': '#202F25',
  '#F8EFE3': '#3C3021',
  '#FFF9F7': '#30211F',
  '#E8C8C2': '#5B3934',
  '#91A098': '#82958A',
  '#94602B': '#E5B46B',
  '#A14337': '#E48779',
};

const darkTextColors: Record<string, string> = {
  ...darkColors,
  '#315E43': '#A6D2B1',
  '#B9CBB7': '#89AD8B',
};
const styleTargets = new Set<unknown>([View, Text, TextInput, Pressable, ScrollView, Animated.View, ExpoImage, SafeAreaView]);

function colorForDarkMode(color: unknown, key: string) {
  if (typeof color !== 'string') return color;
  const normalized = color.toUpperCase();
  if (key === 'color' || key === 'placeholderTextColor' || key === 'tintColor') return darkTextColors[normalized] ?? color;
  if (key === 'backgroundColor' && normalized === '#315E43') return '#254B35';
  if (key.startsWith('border') && normalized === '#315E43') return '#52795D';
  return darkColors[normalized] ?? color;
}

function transformStyle(style: StyleProp<ViewStyle | TextStyle>): ViewStyle & TextStyle {
  const flat = StyleSheet.flatten(style) as (ViewStyle & TextStyle) | undefined;
  if (!flat) return {} as ViewStyle & TextStyle;
  const overrides: Record<string, unknown> = {};
  for (const key of ['backgroundColor', 'color', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'tintColor']) {
    const themed = colorForDarkMode(flat[key as keyof typeof flat], key);
    if (themed !== flat[key as keyof typeof flat]) overrides[key] = themed;
  }
  return overrides as ViewStyle & TextStyle;
}

type ThemedElementProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle | TextStyle> | ((...args: any[]) => StyleProp<ViewStyle | TextStyle>);
  contentContainerStyle?: StyleProp<ViewStyle> | ((...args: any[]) => StyleProp<ViewStyle>);
  placeholderTextColor?: string;
};

function transformNode(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(transformNode);
  if (!isValidElement<ThemedElementProps>(node) || node.type === Fragment) return node;

  const props = node.props;
  const themedStyle = (styleValue: StyleProp<ViewStyle | TextStyle>) => ({
    ...(StyleSheet.flatten(styleValue) ?? {}),
    ...transformStyle(styleValue),
  }) as ViewStyle & TextStyle;
  const themedViewStyle = (styleValue: StyleProp<ViewStyle>) => ({
    ...(StyleSheet.flatten(styleValue) ?? {}),
    ...transformStyle(styleValue),
  }) as ViewStyle;
  const isStyleTarget = styleTargets.has(node.type);
  const styleFunction = isStyleTarget && typeof props.style === 'function' ? props.style as (...args: any[]) => StyleProp<ViewStyle | TextStyle> : null;
  const containerStyleFunction = node.type === ScrollView && typeof props.contentContainerStyle === 'function' ? props.contentContainerStyle as (...args: any[]) => StyleProp<ViewStyle> : null;
  const style = !isStyleTarget ? undefined : styleFunction
    ? (...args: any[]) => themedStyle(styleFunction(...args))
    : props.style ? themedStyle(props.style as StyleProp<ViewStyle | TextStyle>) : undefined;
  const contentContainerStyle = node.type !== ScrollView ? undefined : containerStyleFunction
    ? (...args: any[]) => themedViewStyle(containerStyleFunction(...args))
    : props.contentContainerStyle ? themedViewStyle(props.contentContainerStyle as StyleProp<ViewStyle>) : undefined;

  return cloneElement(node, {
    ...(style ? { style } : {}),
    ...(contentContainerStyle ? { contentContainerStyle } : {}),
    ...(node.type === TextInput && props.placeholderTextColor ? { placeholderTextColor: colorForDarkMode(props.placeholderTextColor, 'placeholderTextColor') as string } : {}),
    children: transformNode(props.children),
  } as Partial<ThemedElementProps>);
}

/** Applies the selected dark palette to native style props throughout a screen's element tree. */
export function ThemeLayer({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const { theme } = useAppPreferences();
  const dark = theme === 'dark' || (theme === 'system' && systemScheme === 'dark');
  const themedChildren = useMemo(() => dark ? transformNode(children) : children, [children, dark]);
  return themedChildren;
}
