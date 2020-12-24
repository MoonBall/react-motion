import React from 'react';
import {StaggeredMotion, spring, presets} from '../../src/react-motion';
import range from 'lodash.range';

export default class Demo extends React.Component {
  constructor(props) {
    super(props);
    this.state = {x: 250, y: 300};
  };

  componentDidMount() {
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('touchmove', this.handleTouchMove);
  };

  handleMouseMove = ({pageX: x, pageY: y}) => {
    this.setState({x, y});
  };

  handleTouchMove = ({touches}) => {
    this.handleMouseMove(touches[0]);
  };

  getStyles = (prevStyles) => {
    // prevStyles 是上一次 raf 调用时，每个元素的理想位置。
    // 按照 msPerFrame 的整数倍来计算的理想值。实际值肯定不会刚好是整数倍。
    // `prevStyles` is the interpolated value of the last tick
    const endValue = prevStyles.map((_, i) => {
      return i === 0
        // 如果是第一个元素，则将其目标设置为最终目标
        // 这里 this.state 是没有 spring 的，下次 raf 会直接将其设置到目标节点。
        // 原因是：这里的场景是头像跟着鼠标移动，第一张头像如果有动画，就会感觉到延迟
        ? this.state
        // 否则为前一个元素上一次 raf 的理想位置
        // 也就是从第二个元素开始才有了 spring 效果
        : {
          x: spring(prevStyles[i - 1].x, presets.gentle),
          y: spring(prevStyles[i - 1].y, presets.gentle),
        };
    });
    return endValue;
  };

  render() {
    return (
      <StaggeredMotion
        defaultStyles={range(6).map(() => ({x: 0, y: 0}))}
        styles={this.getStyles}>
        {balls =>
          <div className="demo1">
            {balls.map(({x, y}, i) =>
              <div
                key={i}
                className={`demo1-ball ball-${i}`}
                style={{
                  WebkitTransform: `translate3d(${x - 25}px, ${y - 25}px, 0)`,
                  transform: `translate3d(${x - 25}px, ${y - 25}px, 0)`,
                  zIndex: balls.length - i,
                }} />
            )}
          </div>
        }
      </StaggeredMotion>
    );
  };
}
