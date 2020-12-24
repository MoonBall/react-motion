/* @flow */
import mapToZero from './mapToZero';
import stripStyle from './stripStyle';
import stepper from './stepper';
import defaultNow from 'performance-now';
import defaultRaf from 'raf';
import shouldStopAnimation from './shouldStopAnimation';
import React from 'react';
import PropTypes from 'prop-types';

import type {
  ReactElement,
  PlainStyle,
  Style,
  Velocity,
  MotionProps,
} from './Types';

const msPerFrame = 1000 / 60;

type MotionState = {
  currentStyle: PlainStyle,
  currentVelocity: Velocity,
  lastIdealStyle: PlainStyle,
  lastIdealVelocity: Velocity,
};

export default class Motion extends React.Component<MotionProps, MotionState> {
  // defaultStyle 用于初始值
  // style 可以是 number，也可以是 spring(0) 生成的对象
  // style 如果是 number，则不会有动画，会在下一个 raf 直接 currentStyle 为该值
  static propTypes = {
    // TOOD: warn against putting a config in here
    defaultStyle: PropTypes.objectOf(PropTypes.number),
    style: PropTypes.objectOf(
      PropTypes.oneOfType([PropTypes.number, PropTypes.object]),
    ).isRequired,
    children: PropTypes.func.isRequired,
    onRest: PropTypes.func,
  };

  constructor(props: MotionProps) {
    super(props);
    this.state = this.defaultState();
  }

  unmounting: boolean = false;
  wasAnimating: boolean = false;
  animationID: ?number = null;
  // 指开启 raf 前的事件。
  // 在 raf 中和 currentTime 做比较，判断是否切换 tab。
  prevTime: number = 0;
  // 一个 raf触发到下一个 raf触发的时间 + 上一次 raf 触发时剩下的 msPerFrame 的余数
  accumulatedTime: number = 0;

  defaultState(): MotionState {
    const { defaultStyle, style } = this.props;
    const currentStyle = defaultStyle || stripStyle(style);
    // 初始速度设置为 0
    const currentVelocity = mapToZero(currentStyle);
    return {
      currentStyle,
      currentVelocity,
      lastIdealStyle: currentStyle,
      lastIdealVelocity: currentVelocity,
    };
  }

  // 当 propStyle 是 { x: 10 }，因为值不是 spring，所以组件状态应该立刻修改成 10，不应该被动画。
  // 但实现上，不管其值是不是 spring，组件和 propStyle 一致是在 raf 中实现的，而不是在 render 阶段。
  // 所以存在一种情况是 raf 中还没消化该 style，但是 propStyle 有改变了。
  // 如果中间这次改变如果是 spring，那么完全不用管，因为调用方期望的是动画，这个时候动画还没开始，所以是满足要求的。
  // 但如果中间这次改变应该是瞬间值，那么就需要处理。

  // it's possible that currentStyle's value is stale: if props is immediately
  // changed from 0 to 400 to spring(0) again, the async currentStyle is still
  // at 0 (didn't have time to tick and interpolate even once). If we naively
  // compare currentStyle with destVal it'll be 0 === 0 (no animation, stop).
  // In reality currentStyle should be 400
  unreadPropStyle: ?Style = null;
  // after checking for unreadPropStyle != null, we manually go set the
  // non-interpolating values (those that are a number, without a spring
  // config)
  clearUnreadPropStyle = (destStyle: Style): void => {
    let dirty = false;
    let {
      currentStyle,
      currentVelocity,
      lastIdealStyle,
      lastIdealVelocity,
    } = this.state;

    for (let key in destStyle) {
      if (!Object.prototype.hasOwnProperty.call(destStyle, key)) {
        continue;
      }

      const styleValue = destStyle[key];
      if (typeof styleValue === 'number') {
        if (!dirty) {
          dirty = true;
          currentStyle = { ...currentStyle };
          currentVelocity = { ...currentVelocity };
          lastIdealStyle = { ...lastIdealStyle };
          lastIdealVelocity = { ...lastIdealVelocity };
        }

        currentStyle[key] = styleValue;
        currentVelocity[key] = 0;
        lastIdealStyle[key] = styleValue;
        lastIdealVelocity[key] = 0;
      }
    }

    if (dirty) {
      this.setState({
        currentStyle,
        currentVelocity,
        lastIdealStyle,
        lastIdealVelocity,
      });
    }
  };

  startAnimationIfNecessary = (): void => {
    if (this.unmounting || this.animationID != null) {
      return;
    }

    // TODO: when config is {a: 10} and dest is {a: 10} do we raf once and
    // call cb? No, otherwise accidental parent rerender causes cb trigger
    this.animationID = defaultRaf(timestamp => {
      // https://github.com/chenglou/react-motion/pull/420
      // > if execution passes the conditional if (this.unmounting), then
      // executes async defaultRaf and after that component unmounts and after
      // that the callback of defaultRaf is called, then setState will be called
      // on unmounted component.
      if (this.unmounting) {
        return;
      }

      // check if we need to animate in the first place
      const propsStyle: Style = this.props.style;
      if (
        shouldStopAnimation(
          this.state.currentStyle,
          propsStyle,
          this.state.currentVelocity,
        )
      ) {
        if (this.wasAnimating && this.props.onRest) {
          this.props.onRest();
        }

        // no need to cancel animationID here; shouldn't have any in flight
        this.animationID = null;
        this.wasAnimating = false;
        this.accumulatedTime = 0;
        return;
      }

      this.wasAnimating = true;

      const currentTime = timestamp || defaultNow();
      const timeDelta = currentTime - this.prevTime;
      this.prevTime = currentTime;
      this.accumulatedTime = this.accumulatedTime + timeDelta;
      // more than 10 frames? prolly switched browser tab. Restart
      if (this.accumulatedTime > msPerFrame * 10) {
        this.accumulatedTime = 0;
      }

      if (this.accumulatedTime === 0) {
        // no need to cancel animationID here; shouldn't have any in flight
        this.animationID = null;
        this.startAnimationIfNecessary();
        return;
      }

      // (accumulatedTime 除以 msPerFrame 的余数) / msPerFrame
      let currentFrameCompletion =
        (this.accumulatedTime -
          Math.floor(this.accumulatedTime / msPerFrame) * msPerFrame) /
        msPerFrame;
      // accumulatedTime 最多有多少 frame 了
      const framesToCatchUp = Math.floor(this.accumulatedTime / msPerFrame);

      let newLastIdealStyle: PlainStyle = {};
      let newLastIdealVelocity: Velocity = {};
      let newCurrentStyle: PlainStyle = {};
      let newCurrentVelocity: Velocity = {};

      for (let key in propsStyle) {
        if (!Object.prototype.hasOwnProperty.call(propsStyle, key)) {
          continue;
        }

        const styleValue = propsStyle[key];
        if (typeof styleValue === 'number') {
          // 如果 style 的值不是 spring，则直接设置为目标值
          newCurrentStyle[key] = styleValue;
          newCurrentVelocity[key] = 0;
          newLastIdealStyle[key] = styleValue;
          newLastIdealVelocity[key] = 0;
        } else {
          let newLastIdealStyleValue = this.state.lastIdealStyle[key];
          let newLastIdealVelocityValue = this.state.lastIdealVelocity[key];
          // 根据当前时间流失的帧数调用多次
          for (let i = 0; i < framesToCatchUp; i++) {
            [newLastIdealStyleValue, newLastIdealVelocityValue] = stepper(
              msPerFrame / 1000,
              newLastIdealStyleValue,
              newLastIdealVelocityValue,
              styleValue.val,
              styleValue.stiffness,
              styleValue.damping,
              styleValue.precision,
            );
          }

          // 为了算当前时刻的值
          const [nextIdealX, nextIdealV] = stepper(
            msPerFrame / 1000,
            newLastIdealStyleValue,
            newLastIdealVelocityValue,
            styleValue.val,
            styleValue.stiffness,
            styleValue.damping,
            styleValue.precision,
          );

          newCurrentStyle[key] =
            newLastIdealStyleValue +
            (nextIdealX - newLastIdealStyleValue) * currentFrameCompletion;
          newCurrentVelocity[key] =
            newLastIdealVelocityValue +
            (nextIdealV - newLastIdealVelocityValue) * currentFrameCompletion;
          newLastIdealStyle[key] = newLastIdealStyleValue;
          newLastIdealVelocity[key] = newLastIdealVelocityValue;
        }
      }

      this.animationID = null;
      // the amount we're looped over above
      this.accumulatedTime -= framesToCatchUp * msPerFrame;

      this.setState({
        currentStyle: newCurrentStyle,
        currentVelocity: newCurrentVelocity,
        lastIdealStyle: newLastIdealStyle,
        lastIdealVelocity: newLastIdealVelocity,
      });

      this.unreadPropStyle = null;

      this.startAnimationIfNecessary();
    });
  };

  componentDidMount() {
    this.prevTime = defaultNow();
    this.startAnimationIfNecessary();
  }

  UNSAFE_componentWillReceiveProps(props: MotionProps) {
    if (this.unreadPropStyle != null) {
      // previous props haven't had the chance to be set yet; set them here
      this.clearUnreadPropStyle(this.unreadPropStyle);
    }

    this.unreadPropStyle = props.style;
    if (this.animationID == null) {
      this.prevTime = defaultNow();
      this.startAnimationIfNecessary();
    }
  }

  componentWillUnmount() {
    this.unmounting = true;
    if (this.animationID != null) {
      defaultRaf.cancel(this.animationID);
      this.animationID = null;
    }
  }

  render(): ReactElement {
    const renderedChildren = this.props.children(this.state.currentStyle);
    return renderedChildren && React.Children.only(renderedChildren);
  }
}
