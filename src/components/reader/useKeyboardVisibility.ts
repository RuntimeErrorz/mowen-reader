import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useKeyboardVisibility(enabled: boolean) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    setVisible(Keyboard.isVisible());
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled]);

  return enabled && visible;
}
